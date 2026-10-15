'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/admin/reviews', label: '审核队列' },
  { href: '/admin/reports', label: '投诉工单' },
  { href: '/admin/corrections', label: '纠错工单' },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="管理后台导航" className="border-b border-divider">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
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
