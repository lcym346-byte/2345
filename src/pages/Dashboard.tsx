import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/authStore';

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  return (
    <div className="space-y-4">
      <div className="card">
        <h2 className="text-lg font-semibold mb-2">
          {t('dashboard.welcome', { name: user?.displayName })}
        </h2>
        <p className="text-sm text-gray-600">{t('dashboard.intro')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center">
          <div className="text-2xl font-bold text-primary-700">0</div>
          <div className="text-sm text-gray-600 mt-1">{t('dashboard.pendingOrders')}</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-primary-700">0</div>
          <div className="text-sm text-gray-600 mt-1">{t('dashboard.todayOrders')}</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-primary-700">0</div>
          <div className="text-sm text-gray-600 mt-1">{t('dashboard.totalProducts')}</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-primary-700">0</div>
          <div className="text-sm text-gray-600 mt-1">{t('dashboard.totalStores')}</div>
        </div>
      </div>

      <div className="card bg-yellow-50 border-yellow-200">
        <p className="text-sm text-yellow-800">
          ⚠️ 階段一系統骨架建置完成，後續階段將陸續加入商品、分店、叫貨、庫存等功能模組。
        </p>
      </div>
    </div>
  );
}
