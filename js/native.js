// Android アプリ版（WebView + ネイティブ）との連携。ブラウザ/PWA として動いているときは何もしない。
// ネイティブ側: android/app/src/main/java/.../NativeBridge.java（window.GymMoNative として公開される）
const bridge = typeof window !== 'undefined' ? window.GymMoNative : undefined;

const call = (name, ...args) => {
  try {
    return bridge?.[name]?.(...args);
  } catch (e) {
    console.warn(`[native] ${name} 失敗`, e);
    return undefined;
  }
};

export const native = {
  /** ネイティブアプリ内で動いているか */
  available: !!bridge,

  info() {
    try {
      return JSON.parse(call('info') || 'null');
    } catch {
      return null;
    }
  },

  /** 休憩タイマーの状態をネイティブへ送る（通知とアラームに反映される） */
  syncTimer(state) {
    call('timerSync', JSON.stringify(state));
  },

  /** 通知のボタン等でネイティブ側が変えた状態を受け取る */
  pollEvents() {
    try {
      return JSON.parse(call('pollEvents') || '[]');
    } catch {
      return [];
    }
  },

  notificationsAllowed() {
    return call('notificationsAllowed') === true;
  },

  requestNotifications() {
    call('requestNotifications');
  },

  /** 通知の許可を求め、結果（true/false）を返す。すでに拒否済みで OS のダイアログが出ない場合もすぐ false が返る */
  askNotifications() {
    if (!bridge) return Promise.resolve(false);
    if (this.notificationsAllowed()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ok) => {
        window.removeEventListener('gymmo-native-permission', onEvent);
        clearTimeout(timer);
        resolve(ok);
      };
      const onEvent = (e) => done(!!e.detail?.notifications);
      const timer = setTimeout(() => done(this.notificationsAllowed()), 20000);
      window.addEventListener('gymmo-native-permission', onEvent);
      call('requestNotifications');
    });
  },

  /** システムバーの色と文字色を Web のテーマに合わせる */
  setTheme(dark, bgHex) {
    call('setTheme', !!dark, bgHex);
  },

  /** ダウンロードフォルダへ保存（WebView は blob: のダウンロードに非対応のため） */
  saveFile(name, mime, text) {
    call('saveFile', name, mime, text);
  },
};
