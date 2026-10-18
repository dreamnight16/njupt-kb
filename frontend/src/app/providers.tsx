'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';

import { ensureCsrfToken } from '@/lib/api/client';
import { installTrustedTypesPolicy } from '@/lib/trusted-types';
import { useAuthStore } from '@/stores/authStore';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
            staleTime: 30 * 1000,
          },
        },
      }),
  );

  useEffect(() => {
    // 账号变化时清除上一账号的数据与进行中的请求，避免复用个人页/管理页缓存。
    return useAuthStore.subscribe((state, previous) => {
      if (previous.user && state.user?.id !== previous.user.id) queryClient.clear();
    });
  }, [queryClient]);

  useEffect(() => {
    // Trusted Types 受限 policy：只在支持该 API 的浏览器注册；不提供 HTML/脚本注入能力。
    installTrustedTypesPolicy();
    // 先取 CSRF 令牌，再探测会话；不阻塞首屏渲染（不再用全屏加载遮罩）。
    void ensureCsrfToken().finally(() => {
      void useAuthStore.getState().hydrate();
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3200,
          style: {
            // DNDL：直角 + 墨色底 + Surface 文字，避免默认圆角浅色气泡。
            borderRadius: '0',
            background: 'var(--dn-ink-primary)',
            color: 'var(--dn-text-on-ink)',
            fontSize: '14px',
            padding: '12px 16px',
            boxShadow: 'var(--dn-shadow-2)',
          },
        }}
      />
    </QueryClientProvider>
  );
}
