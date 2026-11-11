import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { IHome, IList, ICoin, IChart, IGear, IBell } from './icons';
import { UiProvider } from './components/common';
import { useSettings, useUnreadCount, useOnline } from './hooks';
import Home from './pages/Home';
import Holdings from './pages/Holdings';
import HoldingDetail from './pages/HoldingDetail';
import HoldingForm from './pages/HoldingForm';
import Dividends from './pages/Dividends';
import CompanyDividends from './pages/CompanyDividends';
import Analysis from './pages/Analysis';
import Settings from './pages/Settings';
import Notifications from './pages/Notifications';

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'ダッシュボード'], [/^\/holdings\/new/, '銘柄を登録'], [/^\/holdings\/.+\/edit/, '銘柄を編集'], [/^\/holdings\/.+/, '銘柄詳細'], [/^\/holdings/, '保有銘柄'],
  [/^\/dividends\/company/, '企業別の配当履歴'], [/^\/dividends/, '配当金'], [/^\/analysis/, '分析'], [/^\/settings/, '設定'], [/^\/notifications/, '増配・減配の通知'],
];

function Shell() {
  const loc = useLocation();
  const nav = useNavigate();
  const unread = useUnreadCount();
  const settings = useSettings();
  const online = useOnline();
  useEffect(() => { document.documentElement.dataset.color = settings.colorScheme; }, [settings.colorScheme]);
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    const nav2 = navigator as unknown as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try { if (unread > 0) nav2.setAppBadge?.(unread); else nav2.clearAppBadge?.(); } catch { /* noop */ }
  }, [unread]);
  const title = TITLES.find(([r]) => r.test(loc.pathname))?.[1] ?? '';
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">カヴ</span>
        <span className="title">{title}{!online && <span className="pill warn" style={{ marginLeft: 8 }}>オフライン</span>}</span>
        <button className="icon-btn" aria-label={`通知（未確認${unread}件）`} onClick={() => nav('/notifications')}>
          <IBell />{unread > 0 && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/holdings" element={<Holdings />} />
          <Route path="/holdings/new" element={<HoldingForm />} />
          <Route path="/holdings/:id/edit" element={<HoldingForm />} />
          <Route path="/holdings/:id" element={<HoldingDetail />} />
          <Route path="/dividends" element={<Dividends />} />
          <Route path="/dividends/company/:id" element={<CompanyDividends />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="メインメニュー">
        <NavLink to="/" end><IHome />ホーム</NavLink>
        <NavLink to="/holdings"><IList />保有銘柄</NavLink>
        <NavLink to="/dividends"><ICoin />配当金</NavLink>
        <NavLink to="/analysis"><IChart />分析</NavLink>
        <NavLink to="/settings"><IGear />設定</NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return <HashRouter><UiProvider><Shell /></UiProvider></HashRouter>;
}
