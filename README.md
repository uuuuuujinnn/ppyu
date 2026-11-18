# 쀼 가계부

부부 공동 가계부 웹앱이에요. 휴대폰이나 태블릿 크롬에서 열고 '홈 화면에 추가'(앱 설치)를 누르면 앱처럼 쓸 수 있어요.

- 화면: `index.html` (한 파일 앱)
- 로그인·저장소·백업: `fb.js` (Firebase Auth + Firestore)
- 오프라인 실행: `sw.js`, `manifest.webmanifest`
- 보안 규칙: `firestore.rules` (Firebase 콘솔 > Firestore > 규칙에 붙여 넣어요)

가계부 데이터는 이 저장소가 아니라 Firebase에만 저장돼요.
