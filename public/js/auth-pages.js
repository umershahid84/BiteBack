import { api, $, $$, renderHeader, showError, withBusy, getMe, homeFor } from './common.js';

renderHeader('login');
const msg = $('#msg');
const params = new URLSearchParams(location.search);

// Only allow same-site relative redirects.
const safeNext = () => {
  const next = params.get('next') || '';
  return next.startsWith('/') && !next.startsWith('//') ? next : null;
};

getMe().then((user) => {
  if (user) location.replace(safeNext() || homeFor(user));
});

const loginForm = $('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    withBusy($('button[type=submit]', loginForm), async () => {
      try {
        const { user } = await api('/auth/login', { method: 'POST', body: { login: $('#login').value, password: $('#password').value } });
        location.href = safeNext() || homeFor(user);
      } catch (err) {
        showError(msg, err);
      }
    });
  });
}

const signupForm = $('#signup-form');
if (signupForm) {
  let role = params.get('role') === 'restaurant' ? 'restaurant' : 'customer';
  const setRole = (r) => {
    role = r;
    $$('.segmented button').forEach((b) => b.classList.toggle('on', b.dataset.role === r));
    $('#restaurant-fields').classList.toggle('hidden', r !== 'restaurant');
    $('button[type=submit]', signupForm).textContent = r === 'restaurant' ? 'Create restaurant account' : 'Create account';
  };
  $$('.segmented button').forEach((b) => b.addEventListener('click', () => setRole(b.dataset.role)));
  setRole(role);

  signupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = { role, email: $('#email').value, username: $('#username').value, password: $('#password').value };
    if (role === 'restaurant') {
      body.restaurant = {
        name: $('#r-name').value, address: $('#r-address').value, city: $('#r-city').value,
        zip: $('#r-zip').value, phone: $('#r-phone').value, cuisine: $('#r-cuisine').value,
      };
    }
    withBusy($('button[type=submit]', signupForm), async () => {
      try {
        const { user } = await api('/auth/signup', { method: 'POST', body });
        location.href = homeFor(user);
      } catch (err) {
        showError(msg, err);
        msg.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  });
}
