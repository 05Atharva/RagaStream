/**
 * Prahar — the eight watches of the Hindustani day. Ragas belong to times:
 * Bhairav at dawn, Yaman at nightfall, Malkauns past midnight. Home tints its
 * ambient wash by the current prahar; the brand colours never change.
 */
export type Prahar = {
  greeting: string;
  label: string; // shown above the greeting
  raga: string;
  color: string; // ambient wash colour
};

const PRAHARS: Array<{ from: number; to: number } & Prahar> = [
  { from: 4, to: 7, greeting: 'Good morning', label: 'Dawn', raga: 'Bhairav', color: '#F6A96B' },
  { from: 7, to: 10, greeting: 'Good morning', label: 'Morning', raga: 'Bilawal', color: '#F3C26A' },
  { from: 10, to: 13, greeting: 'Good afternoon', label: 'Late morning', raga: 'Sarang', color: '#E8C07A' },
  { from: 13, to: 16, greeting: 'Good afternoon', label: 'Afternoon', raga: 'Multani', color: '#E39A5C' },
  { from: 16, to: 19, greeting: 'Good evening', label: 'Dusk', raga: 'Puriya Dhanashri', color: '#E2775E' },
  { from: 19, to: 22, greeting: 'Good evening', label: 'Nightfall', raga: 'Yaman', color: '#8E79D8' },
  { from: 22, to: 25, greeting: 'Good night', label: 'Night', raga: 'Bageshree', color: '#6E8BFF' },
  { from: 1, to: 4, greeting: 'Still up', label: 'Late night', raga: 'Malkauns', color: '#4C5FC2' },
];

export function currentPrahar(date = new Date()): Prahar {
  const h = date.getHours();
  const hour = h < 1 ? h + 24 : h; // 00:xx belongs to the 22–1 watch
  return PRAHARS.find((p) => hour >= p.from && hour < p.to) ?? PRAHARS[5];
}
