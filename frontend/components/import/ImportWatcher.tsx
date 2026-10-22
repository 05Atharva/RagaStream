import { useImportWatcher } from '../../hooks/useImport';

/** Mounted once in the signed-in app: keeps an import polling when its screen is closed. */
export default function ImportWatcher() {
  useImportWatcher();
  return null;
}
