import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

export default function ProtectedRoute() {
  const { user, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-500">載入中...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.active) {
    return (
      <div className="flex items-center justify-center h-screen p-4">
        <div className="text-center text-red-600">此帳號已被停用，請聯絡管理員</div>
      </div>
    );
  }

  return <Outlet />;
}
