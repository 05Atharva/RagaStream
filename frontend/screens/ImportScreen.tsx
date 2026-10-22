import { useCallback, useEffect, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useNetInfo } from '@react-native-community/netinfo';
import AddSongsSheet from '../components/AddSongsSheet';
import { confirmModal } from '../components/AppModal';
import DoneStep from '../components/import/DoneStep';
import MatchingStep from '../components/import/MatchingStep';
import PasteStep from '../components/import/PasteStep';
import PreviewStep from '../components/import/PreviewStep';
import IconButton from '../components/ui/IconButton';
import Screen from '../components/ui/Screen';
import { Layout, Space } from '../constants/theme';
import { cancelImportJob, useImportJob, useImportPreview, useStartImport } from '../hooks/useImport';
import { usePlaylist } from '../hooks/usePlaylists';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { queryClient } from '../services/queryClient';
import { buildRequest, errorDetail } from '../services/importLogic';
import { invalidatePlaylists } from '../services/libraryActions';
import Toast from '../services/toast';
import { useImportStore } from '../store/importStore';

type Props = NativeStackScreenProps<RootStackParamList, 'Import'>;

const NO_SUGGESTIONS = { songs: [], isLoading: false, isError: false, refetch: () => {} };

/**
 * Bring my playlists (US-22). Paste a link or a song list, check what we found,
 * watch the songs match, then open the playlist. The flow lives in
 * store/importStore so leaving the screen never stops the job.
 */
export default function ImportScreen({ navigation }: Props) {
  const netInfo = useNetInfo();
  const offline = netInfo.isConnected === false;

  const flow = useImportStore((s) => s.flow);
  const draft = useImportStore((s) => s.draft);
  const request = useImportStore((s) => s.request);
  const preview = useImportStore((s) => s.preview);
  const name = useImportStore((s) => s.name);
  const { dispatch, setDraft, setName, setPreview, setScreenFocused, reset } = useImportStore.getState();

  const previewMutation = useImportPreview();
  const startMutation = useStartImport();
  const jobQuery = useImportJob(flow.jobId);
  const job = jobQuery.data;

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const playlistId = job?.playlist_id ?? '';
  const playlistQuery = usePlaylist(playlistId);

  // Tell the watcher when this screen is on top, so a finished job only toasts when you are elsewhere.
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, [setScreenFocused])
  );

  const goBack = useCallback(() => {
    if (flow.step === 'preview') {
      startMutation.reset();
      dispatch({ type: 'back' });
      return;
    }
    // A finished import is done with once you leave it; a running one keeps going.
    if (flow.step === 'done') reset();
    navigation.goBack();
  }, [dispatch, flow.step, navigation, reset, startMutation]);

  // Hardware back steps back through the flow before leaving.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (flow.step === 'preview') {
          goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [flow.step, goBack])
  );

  // Finished while this screen is open: refresh the library.
  useEffect(() => {
    if (job?.status === 'done') invalidatePlaylists(job.playlist_id ? [job.playlist_id] : []);
  }, [job?.status, job?.playlist_id]);

  const findSongs = () => {
    const req = buildRequest(draft);
    if (!req) return;
    previewMutation.mutate(req, { onSuccess: (data) => setPreview(req, data) });
  };

  const startImport = () => {
    if (!preview || !request) return;
    startMutation.mutate(
      { ...request, name: name.trim() || preview.name, description: preview.description ?? undefined },
      { onSuccess: (jobId) => dispatch({ type: 'started', jobId }) }
    );
  };

  const cancelImport = () => {
    const jobId = flow.jobId;
    if (!jobId) return;
    confirmModal({
      title: 'Stop importing?',
      message: "Your playlist won't be created. You can start again any time.",
      confirmLabel: 'Stop import',
      destructive: true,
      icon: 'close-circle-outline',
      onConfirm: () => {
        void cancelImportJob(jobId).catch(() => {});
        queryClient.removeQueries({ queryKey: ['import-job', jobId] });
        startMutation.reset();
        dispatch({ type: 'cancelled' });
        Toast.show({ type: 'info', text1: 'Import stopped' });
      },
    });
  };

  const backToPreview = () => {
    startMutation.reset();
    dispatch({ type: 'retry' });
  };

  const openPlaylist = () => {
    if (!job?.playlist_id) {
      Toast.show({ type: 'error', text1: "Couldn't open the playlist", text2: 'Find it in your Library.' });
      return;
    }
    const id = job.playlist_id;
    invalidatePlaylists([id]);
    reset();
    navigation.replace('Playlist', { playlistId: id });
  };

  const previewError = previewMutation.isError ? errorDetail(previewMutation.error) : null;
  const startError = startMutation.isError ? errorDetail(startMutation.error) : null;
  const loadError = jobQuery.isError && !job ? errorDetail(jobQuery.error) : null;
  const reconnecting = jobQuery.isError && Boolean(job);

  const isMatching = flow.step === 'matching';
  const isDone = flow.step === 'done' && Boolean(job);
  const scrolls = !isMatching && !isDone;

  let body: React.ReactNode;
  if (flow.step === 'preview' && preview) {
    body = (
      <PreviewStep
        key="preview"
        preview={preview}
        name={name}
        onNameChange={setName}
        onImport={startImport}
        onBack={goBack}
        loading={startMutation.isPending}
        offline={offline}
        error={startError}
      />
    );
  } else if (isMatching) {
    body = (
      <MatchingStep
        key="matching"
        job={job}
        loadError={loadError}
        reconnecting={reconnecting}
        onCancel={cancelImport}
        onRetry={job?.status === 'failed' ? backToPreview : () => void jobQuery.refetch()}
        onBackToPreview={backToPreview}
      />
    );
  } else if (isDone && job) {
    body = (
      <DoneStep
        key="done"
        job={job}
        onOpen={openPlaylist}
        onSearch={(q) => {
          setSearchText(q);
          setSearchOpen(true);
        }}
      />
    );
  } else {
    body = (
      <PasteStep
        key="paste"
        value={draft}
        onChange={(v) => {
          if (previewMutation.isError) previewMutation.reset();
          setDraft(v);
        }}
        onFind={findSongs}
        loading={previewMutation.isPending}
        offline={offline}
        error={previewError}
      />
    );
  }

  return (
    <Screen>
      <View style={{ paddingHorizontal: Layout.gutter - Space[2], paddingTop: Space[1] }}>
        <IconButton icon="arrow-back" onPress={goBack} accessibilityLabel={flow.step === 'preview' ? 'Back to the link' : 'Back'} />
      </View>
      {scrolls ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={{ paddingBottom: Space[10], paddingHorizontal: Layout.gutter, paddingTop: Space[4] }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingTop: Space[2] }}>{body}</View>
      )}

      {isDone && job?.playlist_id ? (
        <AddSongsSheet
          isVisible={searchOpen}
          onClose={() => setSearchOpen(false)}
          playlistId={job.playlist_id}
          playlistName={job.name}
          playlistSongs={(playlistQuery.data?.songs ?? []).map((s) => ({ id: s.id, youtube_id: s.youtube_id }))}
          suggested={NO_SUGGESTIONS}
          initialQuery={searchText}
        />
      ) : null}
    </Screen>
  );
}
