import { useState, type FormEvent } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Center } from '@astryxdesign/core/Center';
import { Heading } from '@astryxdesign/core/Heading';
import { Link } from '@astryxdesign/core/Link';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { getOwnerClient } from '@/api/ownerClient';
import { Photo } from '@/components/Photo';
import { useTenant } from '@/features/tenant/TenantRoot';

function loginError(message: string, status?: number): string {
  if (/invalid login credentials/i.test(message)) return 'Неверная почта или пароль.';
  if (/email not confirmed/i.test(message)) return 'Почта ещё не подтверждена. Обратитесь к администратору платформы.';
  if (status === 429 || /rate limit|too many/i.test(message)) return 'Слишком много попыток. Подождите минуту и попробуйте снова.';
  if (/fetch|network/i.test(message)) return 'Нет связи с сервером. Проверьте интернет.';
  return 'Не удалось войти. Попробуйте ещё раз.';
}

/**
 * Owner sign-in (Astryx login-card template). E-mail + password only: there is no
 * sign-up here — owner accounts are created by the platform when a studio is
 * published, and membership in the studio is checked on the server.
 */
export function LoginPage() {
  const { slug, data } = useTenant();
  const t = data.tenant;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password) {
      setError('Введите почту и пароль.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await getOwnerClient(slug).auth.signInWithPassword({ email: email.trim(), password });
      if (authError) setError(loginError(authError.message, authError.status));
    } catch {
      setError(loginError('network'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="owner-login" id="main">
      <Center axis="both" padding={6} minHeight="100dvh">
        <VStack gap={6} hAlign="center" width="100%" maxWidth={400}>
          <VStack gap={3} hAlign="center">
            {t.logo_path ? <Photo path={t.logo_path} alt="" className="owner-login__logo" eager /> : null}
            <Text weight="semibold">{t.name}</Text>
          </VStack>
          <Card padding={8} width="100%">
            <form onSubmit={(e) => void submit(e)} noValidate>
              <VStack gap={5}>
                <VStack gap={1} hAlign="center">
                  <Heading level={1} type="display-3">
                    Кабинет студии
                  </Heading>
                  <Text color="secondary" justify="center">
                    Записи, деньги и настройки студии
                  </Text>
                </VStack>
                <VStack gap={3}>
                  <TextInput
                    label="Почта"
                    type="email"
                    autoComplete="username"
                    htmlName="email"
                    value={email}
                    onChange={(v) => {
                      setEmail(v);
                      setError(null);
                    }}
                    size="lg"
                  />
                  <TextInput
                    label="Пароль"
                    type="password"
                    autoComplete="current-password"
                    htmlName="password"
                    value={password}
                    onChange={(v) => {
                      setPassword(v);
                      setError(null);
                    }}
                    onEnter={() => void submit()}
                    size="lg"
                    status={error ? { type: 'error', message: error } : undefined}
                  />
                </VStack>
                <Button label="Войти" variant="primary" size="lg" width="100%" type="submit" isLoading={busy} />
                <Text type="supporting" color="secondary" justify="center" textWrap="pretty">
                  Регистрации нет: доступ владельцу выдаёт администратор платформы при публикации студии.
                </Text>
              </VStack>
            </form>
          </Card>
          <Link href={`/s/${slug}/`} type="supporting" color="secondary">
            На страницу записи
          </Link>
        </VStack>
      </Center>
    </main>
  );
}
