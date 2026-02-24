# Color Switch – Figma Plugin

Variables 기반 컬러 토큰에서 **바인딩되지 않은 Solid fill/stroke**를 찾아, 선택한 모드(Light/Dark) 기준 **Primitive** 컬렉션 변수와 RGB가 완전히 일치할 때만 자동으로 변수에 바인딩하는 플러그인입니다.

## 요구사항

- Figma 파일에 **Primitive** 라는 이름의 Variable Collection이 있어야 합니다.
- 해당 컬렉션에 **Light** / **Dark** 모드와 **COLOR** 타입 변수가 있어야 합니다.

## 빌드 및 실행

```bash
npm install
npm run build
```

1. Figma 데스크톱 앱에서 **Plugins → Development → Import plugin from manifest…**
2. 프로젝트의 **`dist`** 폴더를 선택합니다.
3. **Plugins → Development → Color Switch** 로 실행합니다.

## 사용 방법

1. **Mode**: Light 또는 Dark 중 선택합니다.
2. **Scan**: 선택 영역(또는 선택이 없으면 현재 페이지 전체)에서 바인딩되지 않은 Solid fill/stroke를 스캔합니다.
3. 결과 리스트에서 노드명, 속성(fills/strokes), 현재 색상, 매칭된 변수(또는 No match)를 확인합니다.
4. **Apply**: 매칭된 항목에만 변수 바인딩을 적용합니다. opacity는 유지됩니다.

## 프로젝트 구조

```
/src
  code.ts   # 플러그인 메인 로직 (스캔, Primitive 매칭, 바인딩 적용)
  ui.html   # UI 마크업
  ui.ts     # UI 스크립트 (모드 선택, Scan/Apply, 결과 표시)
manifest.json
vite.config.ts
```

## v1 제외 사항

- Gradient, Image fill
- Near match(유사 색상 추천)
