import { renderHeader, getMe, homeFor, $$ } from './common.js';

renderHeader();
getMe().then((user) => {
  if (user) $$('a[href^="/signup"]').forEach((a) => (a.href = homeFor(user)));
});
