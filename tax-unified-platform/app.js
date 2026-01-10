// 탭 전환: 각 탭은 원본 엔진을 포함한 iframe을 보여줍니다.
const switchTab = (tab) => {
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
  if (!targetBtn) return;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === targetBtn));
  document.querySelectorAll('.tab-panel').forEach((panel) =>
    panel.classList.toggle('active', panel.id === `tab-${tab}`)
  );
};

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

document.querySelectorAll('[data-tab-jump]').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tabJump));
});
