export type YmaxInstance = 'ymax0' | 'ymax1';

export const DEFAULT_YMAX_INSTANCE: YmaxInstance = 'ymax1';

const DEFAULT_YMAX_UI_URL =
  'https://staging-agentic-ui.ymax0-ui.pages.dev';

const DEFAULT_YDS_URLS: Record<YmaxInstance, string> = {
  ymax0: 'https://main0.ymax.app',
  ymax1: 'https://main1.ymax.app',
};

export function parseYmaxInstance(value: unknown): YmaxInstance {
  if (value === undefined) return DEFAULT_YMAX_INSTANCE;
  if (value === 'ymax0' || value === 'ymax1') return value;
  throw new Error('ymaxInstance must be either ymax0 or ymax1');
}

/** State written before instance selection was introduced belongs to ymax0. */
export const getDelegateYmaxInstance = (
  delegate: { ymaxInstance?: YmaxInstance },
): YmaxInstance => delegate.ymaxInstance ?? 'ymax0';

export const getYmaxUiUrl = (
  override: string | undefined,
): string => override || DEFAULT_YMAX_UI_URL;

export const getYdsUrl = (
  instance: YmaxInstance,
  override: string | undefined,
): string => override || DEFAULT_YDS_URLS[instance];
