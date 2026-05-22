import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="text-6xl font-bold text-gray-300">404</div>
      <p className="text-gray-600 mt-4">{t('notFound.message')}</p>
      <Link to="/" className="btn-primary mt-6">
        {t('notFound.back')}
      </Link>
    </div>
  );
}
