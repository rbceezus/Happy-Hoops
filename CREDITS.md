# Créditos

- **Modelo humano com esqueleto e animações** (`client/public/models/athlete-rig.glb`): derivado do `AnimationLibrary.glb`
  do repositório [pmndrs/ecctrl](https://github.com/pmndrs/ecctrl) (MIT, © 2023-2026 Erdong Chen), que por sua vez usa a
  *Universal Animation Library* do **Quaternius** (CC0). O arquivo foi reduzido (só as animações usadas, translações
  desnecessárias removidas) com `@gltf-transform`.
- A forma de montar o personagem (um modelo clonado por atleta + máquina de estados que mapeia o estado do jogador para
  clipes com `crossFade`) segue o padrão do `AnimatedCharacterModel` do ecctrl. O ecctrl em si (física Rapier + React Three
  Fiber) não é usado: no Happy Hoops o movimento é decidido pelo servidor.
- Fontes: Barlow / Barlow Condensed (OFL) via `@fontsource`.
