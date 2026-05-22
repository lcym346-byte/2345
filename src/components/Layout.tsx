import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Home, Package, Store, FileText, BarChart3, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { signOut } from '@/lib/auth';
import LanguageSwitcher from './LanguageSwitcher';

export default function Layout() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await signOut();
    navigate('/login');
  };

  const navItems = [
    { path: '/dashboard', icon: Home, label: t('nav.dashboard') },
    { path: '/orders', icon: FileText, label: t('nav.orders') },
    { path: '/products', icon: Package, label: t('nav.products') },
    { path: '/stores', icon: Store, label: t('nav.stores') },
    { path: '/reports', icon: BarChart3, label: t('nav.reports') }
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-primary-700 text-white sticky top-0 z-50 shadow">
        <div className="flex items-center justify-between px-4 h-14">
          <button onClick={() => setMenuOpen(!menuOpen)} className="p-1">
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <h1 className="text-base font-semibold truncate">{t('app.title')}</h1>
          <LanguageSwitcher />
        </div>
      </header>

      {menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setMenuOpen(false)}>
          <nav className="absolute left-0 top-14 bottom-0 w-64 bg-white shadow-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-4 border-b">
              <div className="font-medium">{user?.displayName}</div>
              <div className="text-sm text-gray-500">{t(`role.${user?.role}`)}</div>
            </div>
            <ul className="py-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      onClick={() => setMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 ${
                        active ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                      }`}
                    >
                      <Icon size={20} />
                      <span>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-3 text-red-600"
                >
                  <LogOut size={20} />
                  <span>{t('nav.logout')}</span>
                </button>
              </li>
            </ul>
          </nav>
        </div>
      )}

      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
