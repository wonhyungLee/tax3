// 탭 전환: 각 탭은 원본 엔진을 포함한 iframe을 보여줍니다.
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((panel) =>
      panel.classList.toggle('active', panel.id === `tab-${tab}`)
    );
  });
});
