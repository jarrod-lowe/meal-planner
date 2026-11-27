<script lang="ts">
  import type { AuthErrorCode } from '#lib/auth/client.js';
  import { t } from '#lib/i18n/en.js';
  import { session } from '#lib/stores/session.svelte.js';

  type FormError = AuthErrorCode | 'mismatch';

  let email = $state('');
  let password = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let code = $state('');
  let mismatch = $state(false);

  const error = $derived<FormError | null>(mismatch ? 'mismatch' : session.error);
  const errorId = 'login-error';
  const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(' ') || undefined;

  const headings = {
    signIn: t('login.signIn.heading'),
    newPassword: t('login.newPasswordStep.heading'),
    forgotPassword: t('login.forgotPasswordStep.heading'),
    resetCode: t('login.resetCodeStep.heading'),
    resetDone: t('login.resetDoneStep.heading')
  } as const;

  // Move focus to the new step's heading when the step changes, but not on
  // first load, so the page starts where the browser puts it.
  let firstHeading = true;
  function focusOnStepChange(node: HTMLElement) {
    if (firstHeading) {
      firstHeading = false;
      return;
    }
    node.focus();
  }

  function clearPasswords() {
    password = '';
    newPassword = '';
    confirmPassword = '';
    code = '';
    mismatch = false;
  }

  /** Checks the new-password pair; the policy itself is Cognito's. */
  function passwordsMatch() {
    mismatch = newPassword !== confirmPassword;
    return !mismatch;
  }

  async function submitSignIn(event: SubmitEvent) {
    event.preventDefault();
    await session.signIn(email, password);
    if (session.step !== 'signIn') clearPasswords();
  }

  async function submitNewPassword(event: SubmitEvent) {
    event.preventDefault();
    if (!passwordsMatch()) return;
    await session.confirmNewPassword(newPassword);
  }

  async function submitForgot(event: SubmitEvent) {
    event.preventDefault();
    await session.requestPasswordReset(email);
  }

  async function submitResetCode(event: SubmitEvent) {
    event.preventDefault();
    if (!passwordsMatch()) return;
    await session.confirmPasswordReset(code, newPassword);
    if (session.step === 'resetDone') clearPasswords();
  }

  function forgotPassword() {
    clearPasswords();
    session.forgotPassword();
  }

  function backToSignIn() {
    clearPasswords();
    session.backToSignIn();
  }
</script>

<svelte:head>
  <title>{t('login.title')}</title>
</svelte:head>

{#snippet errorRegion()}
  <div id={errorId} class="error" role="alert">
    {#if error}{t(`login.errors.${error}`)}{/if}
  </div>
{/snippet}

{#snippet submit(label: string, busy: string)}
  <button type="submit" class="primary" disabled={session.pending} aria-busy={session.pending}>
    {session.pending ? busy : label}
  </button>
{/snippet}

{#snippet backButton()}
  <button type="button" class="link" onclick={backToSignIn}>{t('login.backToSignIn')}</button>
{/snippet}

{#snippet newPasswordFields()}
  <div class="field">
    <label for="new-password">{t('login.newPassword')}</label>
    <input
      id="new-password"
      type="password"
      autocomplete="new-password"
      required
      bind:value={newPassword}
      oninput={() => (mismatch = false)}
      aria-invalid={error === 'passwordPolicy' || undefined}
      aria-describedby={describedBy('new-password-help', error === 'passwordPolicy' && errorId)}
    />
    <p id="new-password-help" class="help">{t('login.passwordHelp')}</p>
  </div>
  <div class="field">
    <label for="confirm-password">{t('login.confirmPassword')}</label>
    <input
      id="confirm-password"
      type="password"
      autocomplete="new-password"
      required
      bind:value={confirmPassword}
      oninput={() => (mismatch = false)}
      aria-invalid={error === 'mismatch' || undefined}
      aria-describedby={describedBy(error === 'mismatch' && errorId)}
    />
  </div>
{/snippet}

<main>
  {#key session.step}
    <h1 tabindex="-1" {@attach focusOnStepChange}>{headings[session.step]}</h1>
  {/key}

  {#if session.step === 'signIn'}
    <form onsubmit={submitSignIn} aria-describedby={describedBy(!!error && errorId)}>
      {@render errorRegion()}
      <div class="field">
        <label for="email">{t('login.email')}</label>
        <input
          id="email"
          type="email"
          autocomplete="username"
          required
          bind:value={email}
          aria-invalid={error === 'invalidCredentials' || undefined}
          aria-describedby={describedBy(error === 'invalidCredentials' && errorId)}
        />
      </div>
      <div class="field">
        <label for="password">{t('login.password')}</label>
        <input
          id="password"
          type="password"
          autocomplete="current-password"
          required
          bind:value={password}
          aria-invalid={error === 'invalidCredentials' || undefined}
          aria-describedby={describedBy(error === 'invalidCredentials' && errorId)}
        />
      </div>
      {@render submit(t('login.signIn.submit'), t('login.signIn.busy'))}
    </form>
    <button type="button" class="link" onclick={forgotPassword}>{t('login.forgotPassword')}</button>
  {:else if session.step === 'newPassword'}
    <p>{t('login.newPasswordStep.intro')}</p>
    <form onsubmit={submitNewPassword} aria-describedby={describedBy(!!error && errorId)}>
      {@render errorRegion()}
      {@render newPasswordFields()}
      {@render submit(t('login.newPasswordStep.submit'), t('login.newPasswordStep.busy'))}
    </form>
    {@render backButton()}
  {:else if session.step === 'forgotPassword'}
    <p>{t('login.forgotPasswordStep.intro')}</p>
    <form onsubmit={submitForgot} aria-describedby={describedBy(!!error && errorId)}>
      {@render errorRegion()}
      <div class="field">
        <label for="email">{t('login.email')}</label>
        <input id="email" type="email" autocomplete="username" required bind:value={email} />
      </div>
      {@render submit(t('login.forgotPasswordStep.submit'), t('login.forgotPasswordStep.busy'))}
    </form>
    {@render backButton()}
  {:else if session.step === 'resetCode'}
    <p>{t('login.resetCodeStep.intro', { email: session.resetEmail })}</p>
    <form onsubmit={submitResetCode} aria-describedby={describedBy(!!error && errorId)}>
      {@render errorRegion()}
      <div class="field">
        <label for="code">{t('login.code')}</label>
        <input
          id="code"
          type="text"
          inputmode="numeric"
          autocomplete="one-time-code"
          required
          bind:value={code}
          aria-invalid={error === 'invalidCode' || undefined}
          aria-describedby={describedBy(error === 'invalidCode' && errorId)}
        />
      </div>
      {@render newPasswordFields()}
      {@render submit(t('login.resetCodeStep.submit'), t('login.resetCodeStep.busy'))}
    </form>
    {@render backButton()}
  {:else}
    <p role="status">{t('login.resetDoneStep.message')}</p>
    <button type="button" class="primary" onclick={backToSignIn}>{t('login.backToSignIn')}</button>
  {/if}
</main>

<style>
  main {
    max-width: 28rem;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h1 {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-tight);
    margin: 0;
  }

  p {
    margin: 0;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  label {
    font-weight: var(--font-weight-bold);
  }

  input {
    font: inherit;
    color: var(--color-text);
    background: var(--color-surface-raised);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }

  input[aria-invalid='true'] {
    border-color: var(--color-danger);
  }

  .help {
    color: var(--color-text-muted);
    font-size: var(--font-size-sm);
  }

  .error {
    color: var(--color-danger);
    font-weight: var(--font-weight-bold);
  }

  button {
    font: inherit;
    cursor: pointer;
  }

  .primary {
    color: var(--color-primary-text);
    background: var(--color-primary);
    border: none;
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    font-weight: var(--font-weight-bold);
  }

  .primary:disabled {
    cursor: progress;
    opacity: 0.7;
  }

  .link {
    align-self: flex-start;
    color: var(--color-primary);
    background: none;
    border: none;
    padding: var(--space-2) 0;
    text-decoration: underline;
  }
</style>
