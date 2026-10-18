'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Captcha, fetchCaptcha, register } from '@/lib/api/auth';
import { describeError } from '@/lib/api/client';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [captcha, setCaptcha] = useState<Captcha | null>(null);
  const [captchaCode, setCaptchaCode] = useState('');

  // 一次性验证码：进入页面与每次提交失败后都换新码，避免旧码已被消费。
  const loadCaptcha = useCallback(async () => {
    setCaptchaCode('');
    try {
      setCaptcha(await fetchCaptcha('register'));
    } catch {
      setCaptcha(null);
    }
  }, []);

  useEffect(() => {
    void loadCaptcha();
  }, [loadCaptcha]);

  const registerMutation = useMutation({
    mutationFn: () =>
      register({
        email: email.trim(),
        password,
        display_name: displayName.trim() || undefined,
        captcha_id: captcha?.captcha_id,
        captcha_code: captchaCode.trim() || undefined,
      }),
    onError: () => {
      // 提交失败后旧码可能已失效/被消费，换新码再试。
      void loadCaptcha();
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    registerMutation.mutate();
  }

  const error = registerMutation.error ? describeError(registerMutation.error) : null;
  const result = registerMutation.data;

  if (result) {
    return (
      <div className="space-y-6">
        <header>
          <p className="dn-kicker text-text-secondary">REGISTERED</p>
          <h1 className="dn-display mt-1 text-3xl">注册成功</h1>
        </header>
        <Notice tone="success" title={result.message}>
          <p>
            账号状态：{result.status}
            {result.email_verification_sent ? '，验证邮件已发送。' : '。'}
          </p>
          {result.note && <p className="mt-1">{result.note}</p>}
          <p className="mt-1">
            邮箱验证只证明你当时控制该邮箱，不代表完成官方学生身份认证。
          </p>
        </Notice>
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center bg-brand px-4 text-sm font-medium text-on-color hover:bg-brand/90"
        >
          前往登录
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="dn-kicker text-text-secondary">CREATE ACCOUNT</p>
        <h1 className="dn-display mt-1 text-3xl">注册</h1>
        <p className="mt-2 text-sm text-text-secondary">
          注册后需完成邮箱验证才能上传资料。
        </p>
      </header>

      {error && (
        <Notice tone="error" title="注册未完成">
          {error.message}
          <p className="mt-1">请检查填写内容。</p>
        </Notice>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="邮箱"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label="昵称（可选）"
          name="display_name"
          autoComplete="nickname"
          maxLength={80}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        <Input
          label="密码"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <p className="text-xs text-text-secondary">
          建议使用较长的密码，避免与其他网站重复使用。
        </p>

        <div>
          <label htmlFor="captcha_code" className="block text-sm">
            图形验证码
          </label>
          <div className="mt-1 flex items-stretch gap-3">
            <Input
              id="captcha_code"
              name="captcha_code"
              autoComplete="off"
              required
              maxLength={6}
              placeholder="不区分大小写"
              value={captchaCode}
              onChange={(event) => setCaptchaCode(event.target.value)}
            />
            <button
              type="button"
              onClick={() => void loadCaptcha()}
              aria-label="换一张验证码"
              title="点击刷新验证码"
              className="min-h-11 shrink-0 border border-divider bg-white px-2 hover:bg-canvas"
            >
              {captcha ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={captcha.image}
                  alt="图形验证码"
                  width={126}
                  height={45}
                  className="block"
                />
              ) : (
                <span className="flex h-[45px] w-28 items-center justify-center text-center text-xs">
                  加载失败，点此重试
                </span>
              )}
            </button>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            看不清？点击图片换一张。验证码一次性有效，提交失败后会自动刷新。
          </p>
        </div>

        <Button type="submit" className="w-full" isLoading={registerMutation.isPending}>
          注册
        </Button>
      </form>

      <p className="text-sm text-text-secondary">
        已有账号？
        <Link href="/login" className="ml-1 text-text-primary underline underline-offset-2">
          去登录
        </Link>
      </p>
    </div>
  );
}
