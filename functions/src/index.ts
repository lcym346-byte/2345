import { onCall } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

admin.initializeApp();

// 階段一預留：健康檢查
export const ping = onCall({ region: 'asia-east1' }, async () => {
  return { ok: true, time: Date.now() };
});

// 後續階段將加入：叫貨單狀態流轉、通知、ERP 串接介面等
