'use client';

import { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * 路由切换进度条：点击站内链接立即给出反馈，路径变化后收尾。
 * 只覆盖导航等待期，不做整页重播动画（DESIGN.md §13：动效解释状态）。
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = pathname + (searchParams.size ? `?${searchParams}` : '');
  const [navigation, setNavigation] = useState<{ from: string; startedAt: number } | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as HTMLElement | null)?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      setNavigation({ from: window.location.pathname + window.location.search, startedAt: Date.now() });
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  useEffect(() => {
    if (!navigation) return;
    // URL 提交后才结束；导航失败或取消时最多等待 15 秒。
    const wait = route === navigation.from
      ? Math.max(0, 15_000 - (Date.now() - navigation.startedAt))
      : Math.max(0, 240 - (Date.now() - navigation.startedAt));
    const timer = window.setTimeout(() => setNavigation(null), wait);
    return () => window.clearTimeout(timer);
  }, [navigation, route]);

  if (!navigation) return null;

  return (
    <div
      role="progressbar"
      aria-label="页面加载中"
      aria-busy="true"
      className="dn-progress-bar fixed inset-x-0 top-0 z-50 h-0.5 bg-brand"
    />
  );
}
