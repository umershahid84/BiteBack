import { renderHeader, $ } from './common.js';

renderHeader();
$('#print-btn')?.addEventListener('click', () => print());
