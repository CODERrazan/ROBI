export type AvatarSlot = 'hair' | 'hat' | 'face' | 'faceAccessory' | 'neckAccessory' | 'shouldersAccessory' | 'frontAccessory' | 'backAccessory' | 'waistAccessory' | 'shirt' | 'pants' | 'tshirt' | 'layered';
export type AvatarItem = {
  slot: AvatarSlot;
  source: 'roblox' | 'mock';
  assetId?: number;
  mockId?: string;
  verified?: boolean;
  name: string;
  price?: number;
  accessoryType?: string;
  [key: string]: unknown;
};
export type AvatarConfig = {
  version: 1;
  rigType: 'R15';
  bodyColors: Record<string, string>;
  scales: Record<string, number>;
  items: AvatarItem[];
};
export function emptyConfig(): AvatarConfig;
export function setItem(config: AvatarConfig, item: AvatarItem): AvatarConfig;
export function removeItem(config: AvatarConfig, slot: AvatarSlot, id?: string): AvatarConfig;
