'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CollegeBrief, MajorBrief } from '@/lib/api/catalog';

interface Props {
  colleges: CollegeBrief[];
  majors: MajorBrief[];
  keyword: string;
  collegeId: string;
  majorId: string;
  hasFilters: boolean;
}

export default function CoursesFilterForm({
  colleges,
  majors,
  keyword,
  collegeId: initialCollegeId,
  majorId: initialMajorId,
  hasFilters,
}: Props) {
  const [collegeId, setCollegeId] = useState(initialCollegeId);
  const [majorId, setMajorId] = useState(initialMajorId);
  const [search, setSearch] = useState(keyword);

  const filteredMajors = collegeId
    ? majors.filter((m) => m.college_id === collegeId)
    : majors;

  return (
    <form action="/courses" method="get" className="grid gap-3 border border-divider bg-surface p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
      <div>
        <label htmlFor="course-q" className="mb-1 block text-sm font-medium text-text-primary">
          课程名 / 代码 / 简称
        </label>
        <input
          id="course-q"
          name="q"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="例如：数据结构、B0300010、数构"
          className="min-h-11 w-full border border-control-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-secondary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
        />
      </div>
      <div>
        <label htmlFor="course-college" className="mb-1 block text-sm font-medium text-text-primary">
          学院
        </label>
        <select
          id="course-college"
          name="college_id"
          value={collegeId}
          onChange={(e) => {
            setCollegeId(e.target.value);
            setMajorId('');
          }}
          className="min-h-11 w-full border border-control-border bg-surface px-3 text-sm text-text-primary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
        >
          <option value="">全部学院</option>
          {colleges.map((college) => (
            <option key={college.id} value={college.id}>
              {college.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="course-major" className="mb-1 block text-sm font-medium text-text-primary">
          专业
        </label>
        <select
          id="course-major"
          name="major_id"
          value={majorId}
          onChange={(e) => setMajorId(e.target.value)}
          className="min-h-11 w-full border border-control-border bg-surface px-3 text-sm text-text-primary focus:border-brand focus:outline-2 focus:outline-offset-1 focus:outline-focus"
        >
          <option value="">全部专业</option>
          {filteredMajors.map((major) => (
            <option key={major.id} value={major.id}>
              {major.college_name} · {major.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <button
          type="submit"
          className="inline-flex min-h-11 items-center bg-brand px-4 text-sm font-medium text-on-color hover:bg-brand/90"
        >
          筛选
        </button>
        {(hasFilters || search || collegeId || majorId) && (
          <Link
            href="/courses"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              setSearch('');
              setCollegeId('');
              setMajorId('');
            }}
            className="inline-flex min-h-11 items-center border border-control-border px-4 text-sm font-medium text-text-primary hover:bg-canvas"
          >
            清除
          </Link>
        )}
      </div>
    </form>
  );
}
