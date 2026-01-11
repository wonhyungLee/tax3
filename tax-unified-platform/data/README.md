# 데이터 업데이트 메모

- `scripts/update-tax-data.sh`는 `TAX_DATA_URL` 환경변수가 있으면 해당 JSON을 `data/latest.json`으로 내려받고, 없으면 `last-update.txt`에 타임스탬프를 기록합니다.
- 정기 자동화는 `.github/workflows/data-update.yml`에서 실행되며, 필요 시 데이터 소스를 설정해 주세요.
