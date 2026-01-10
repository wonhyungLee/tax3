# 통합 세금 플랫폼

연말정산 · 법인세 · 금융소득 종합과세 **원본 엔진**을 그대로 임베드해 탭으로 전환하며 쓸 수 있는 정적 웹 앱입니다. 각 탭은 기존 프로젝트의 입력 필드·계산 로직을 유지합니다.

## 특징
- **연말정산** (`yearend/`): 기존 연말정산 UI/스크립트를 그대로 포함.
- **법인세** (`corporate/`): TaxCore 2025 웹 시뮬레이터 원본 페이지 임베드.
- **금융소득 종합과세** (`financial/`): 2천만원 비교과세, Gross-up, 외국납부세액공제 로직 포함한 원본 페이지 임베드.
- 메인 페이지는 탭/버튼/배포 가이드만 제공하며 각 탭은 iframe으로 원본 화면을 보여줍니다.

## 파일 구성
- `index.html` : 탭/히어로/배포 가이드
- `styles.css` : 메인 페이지 스타일
- `app.js` : 탭 전환만 담당
- `yearend/` : 기존 연말정산 `index.html`, `styles.css`, `script.js`, `assets/`
- `corporate/` : 기존 TaxCore 웹 `index.html`
- `financial/` : 기존 금융소득 UI `index.html` + `taxEngine.js`

## 로컬 확인
정적 사이트이므로 간단히 미리보기할 수 있습니다.
```bash
cd tax-unified-platform
python -m http.server 8787
# 브라우저에서 http://localhost:8787
```

## 배포 (GitHub → Cloudflare Pages)
1. 이 폴더를 GitHub 리포지토리 루트에 올립니다.
2. Cloudflare Pages에서 새 프로젝트 생성 후 해당 리포지토리를 연결합니다.
3. Build command: 없음 / Output directory: `/`
4. 배포 후 각 탭의 “새 창에서 열기”와 iframe 내 계산이 정상 동작하는지 확인합니다.
