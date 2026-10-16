'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isAdmin, useAuthStore } from '@/stores/authStore';

const items = [
  { href: '/admin/reviews', label: '审核队列' },
  { href: '/admin/reports', label: '投诉工单' },
  { href: '/admin/corrections', label: '纠错工单' },
];

export function AdminNav() {
  const pathname = usePathname();
  const user = useAuthStore(s => s.user);

  return (
    <nav aria-label="管理后台导航" className="border-b border-divider">
      <ul className="flex flex-wrap gap-1">
        {isAdmin(user) && <li><Link href="/admin/imports" aria-current={pathname === '/admin/imports' ? 'page' : undefined} className="flex min-h-11 items-center px-4 text-sm font-medium">批量上传</Link></li>}
        {(isAdmin(user) ? [{href:'/admin/workbench',label:'工作台'}, ...items, {href:'/admin/catalog',label:'目录维护'}, {href:'/admin/comments',label:'评论管理'}, {href:'/admin/events',label:'失败事件'}] : items).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center px-4 text-sm font-medium ${
                  active
                    ? 'bg-brand text-on-color'
                    : 'text-text-secondary hover:bg-canvas hover:text-text-primary'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
