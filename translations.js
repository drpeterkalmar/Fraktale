const TRANSLATIONS = {
    de: {
        title: "Fraktal-Explorer", re: "Re", im: "Im", zoom: "Zoom", iterations: "Iterationen", mode: "Modus", fps: "FPS", version: "Version",
        reset_view: "Ansicht zurücksetzen (R)", screenshot: "Screenshot (S)", fullscreen: "Vollbild (F)", zoom_mode: "Zoom-Modus (Z)", change_mode: "Modus wechseln (M)", help: "Was ist ein Fraktal? (?)", toggle_info: "Info ein/aus (I)", change_lang: "Sprache wechseln (L)", formula: "Formel",
        mandelbrot: "MANDELBROT", julia: "JULIA-MENGE", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "Was ist ein Fraktal? 🌀", fractal_desc: "Ein Fraktal ist ein mathematisches Wunderwerk. Stell dir ein Bild vor, in das du immer weiter hineinzoomen kannst, und es tauchen immer wieder neue, wunderschöne Muster auf, die dem Ganzen ähneln.",
        magic_formula: "Die Zauberformel: z = z² + c ✨", magic_desc: "Du nimmst eine Zahl (z), nimmst sie mit sich selbst mal (z²) und zählst eine feste Zahl (c) dazu. Das Ergebnis nimmst du dann als neues (z) und machst das immer wieder.",
        why_black: "Warum ist das 'Männchen' schwarz? 🌑", trapped: "Gefangen", trapped_desc: "Die Zahl bleibt klein und 'kreist' immer weiter herum. Diese Punkte gehören zum Fraktal und wir malen sie schwarz an.",
        escape: "Flucht", escape_desc: "Die Zahl wird riesig und schießt wie eine Rakete ins Unendliche ab!",
        color_origin: "Woher kommen die bunten Farben? 🌈", color_desc: "Die Farben zeigen uns, wie schnell eine Zahl 'geflüchtet' ist. Eine Zahl, die schon nach 3 Schritten riesig wird, bekommt eine andere Farbe als eine, die 100 Schritte gebraucht hat.",
        controls: "Steuerung 🎮", ctrl_scroll: "Rein- und Rauszoomen.", ctrl_drag: "Ziehen zum Verschieben.", ctrl_shift: "Shift + Ziehen für Zoom.", ctrl_keys: "Pfeiltasten zum Bewegen, +/− für Details."
    },
    en: {
        title: "Fractal Explorer", re: "Re", im: "Im", zoom: "Zoom", iterations: "Iterations", mode: "Mode", fps: "FPS", version: "Version",
        reset_view: "Reset View (R)", screenshot: "Screenshot (S)", fullscreen: "Fullscreen (F)", zoom_mode: "Zoom Mode (Z)", change_mode: "Change Mode (M)", help: "What is a Fractal? (?)", toggle_info: "Toggle Info (I)", change_lang: "Change Language (L)", formula: "Formula",
        mandelbrot: "MANDELBROT", julia: "JULIA SET", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "What is a Fractal? 🌀", fractal_desc: "A fractal is a mathematical wonder. Imagine an image that you can zoom into infinitely, and new, beautiful patterns keep appearing that resemble the whole.",
        magic_formula: "The Magic Formula: z = z² + c ✨", magic_desc: "You take a number (z), multiply it by itself (z²), and add a fixed number (c). You then take the result as the new (z) and repeat this process.",
        why_black: "Why is the 'Man' black? 🌑", trapped: "Trapped", trapped_desc: "The number stays small and keeps 'orbiting'. These points belong to the fractal and we paint them black.",
        escape: "Escape", escape_desc: "The number becomes huge and shoots off into infinity like a rocket!",
        color_origin: "Where do the colors come from? 🌈", color_desc: "The colors show us how fast a number 'escaped'. A number that becomes huge after only 3 steps gets a different color than one that took 100 steps.",
        controls: "Controls 🎮", ctrl_scroll: "Scroll to zoom in and out.", ctrl_drag: "Click and drag to pan.", ctrl_shift: "Shift + drag for zoom selection.", ctrl_keys: "Arrow keys to move, +/− for details."
    },
    hu: {
        title: "Fraktál Explorer", re: "Re", im: "Im", zoom: "Nagyítás", iterations: "Iterációk", mode: "Mód", fps: "FPS", version: "Verzió",
        reset_view: "Nézet alaphelyzetbe (R)", screenshot: "Képernyőkép (S)", fullscreen: "Teljes képernyő (F)", zoom_mode: "Nagyítás mód (Z)", change_mode: "Mód váltása (M)", help: "Mi az a fraktál? (?)", toggle_info: "Infó ki/be (I)", change_lang: "Nyelv váltása (L)", formula: "Képlet",
        mandelbrot: "MANDELBROT", julia: "JULIA-HALMAZ", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "Mi az a fraktál? 🌀", fractal_desc: "A fraktál egy matematikai csoda. Képzelj el egy képet, amibe végtelenül belenagyíthatsz, és újra és újra új, gyönyörű minták jelennek meg, amelyek hasonlítanak az egészre.",
        magic_formula: "A bűvös képlet: z = z² + c ✨", magic_desc: "Veszel egy számot (z), megszorzod önmagával (z²), és hozzáadsz egy fix számot (c). Az eredményt veszed új (z)-nek, és ezt ismétled újra és újra.",
        why_black: "Miért fekete az 'emberke'? 🌑", trapped: "Csapdába esett", trapped_desc: "A szám kicsi marad és tovább 'kering'. Ezek a pontok a fraktálhoz tartoznak, és feketére festjük őket.",
        escape: "Menekülés", escape_desc: "A szám hatalmas lesz, és mint egy rakéta, kilő a végtelenbe!",
        color_origin: "Honnan jönnek a színek? 🌈", color_desc: "A színek megmutatják, milyen gyorsan 'menekült' el egy szám. Egy szám, amely már 3 lépés után hatalmas lesz, más színt kap, mint az, amelyiknek 100 lépés kellett.",
        controls: "Irányítás 🎮", ctrl_scroll: "Görgetés a nagyításhoz.", ctrl_drag: "Kattintás és húzás a mozgatáshoz.", ctrl_shift: "Shift + húzás a kijelölt nagyításhoz.", ctrl_keys: "Nyilak a mozgatáshoz, +/− a részletekért."
    },
    es: {
        title: "Explorador de Fractales", re: "Re", im: "Im", zoom: "Zoom", iterations: "Iteraciones", mode: "Modo", fps: "FPS", version: "Versión",
        reset_view: "Restablecer vista (R)", screenshot: "Captura de pantalla (S)", fullscreen: "Pantalla completa (F)", zoom_mode: "Modo de zoom (Z)", change_mode: "Cambiar modo (M)", help: "¿Qué es un fractal? (?)", toggle_info: "Alternar información (I)", change_lang: "Cambiar idioma (L)", formula: "Fórmula",
        mandelbrot: "MANDELBROT", julia: "CONJUNTO DE JULIA", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "¿Qué es un fractal? 🌀", fractal_desc: "Un fractal es una maravilla matemática. Imagina una imagen en la que puedes hacer zoom infinitamente, y siguen apareciendo patrones nuevos y hermosos que se asemejan al todo.",
        magic_formula: "La fórmula mágica: z = z² + c ✨", magic_desc: "Tomas un número (z), lo multiplicas por sí mismo (z²) y le sumas un número fijo (c). Luego tomas el resultado como el nuevo (z) y repites el proceso.",
        why_black: "¿Por qué el 'hombrecito' es negro? 🌑", trapped: "Atrapado", trapped_desc: "El número permanece pequeño y sigue 'orbitando'. Estos puntos pertenecen al fractal y los pintamos de negro.",
        escape: "Escape", escape_desc: "¡El número se vuelve enorme y sale disparado hacia el infinito como un cohete!",
        color_origin: "¿De dónde vienen los colores? 🌈", color_desc: "Los colores nos muestran qué tan rápido 'escapó' un número. Un número que se vuelve enorme después de solo 3 pasos obtiene un color diferente al de uno que tomó 100 pasos.",
        controls: "Controles 🎮", ctrl_scroll: "Desplázate para acercar y alejar.", ctrl_drag: "Haz clic y arrastra para desplazar.", ctrl_shift: "Shift + arrastrar para selección de zoom.", ctrl_keys: "Teclas de flecha para mover, +/− para detalles."
    },
    fr: {
        title: "Explorateur de Fractals", re: "Re", im: "Im", zoom: "Zoom", iterations: "Itérations", mode: "Mode", fps: "FPS", version: "Version",
        reset_view: "Réinitialiser la vue (R)", screenshot: "Capture d'écran (S)", fullscreen: "Plein écran (F)", zoom_mode: "Mode zoom (Z)", change_mode: "Changer de mode (M)", help: "Qu'est-ce qu'un fractal ? (?)", toggle_info: "Afficher les infos (I)", change_lang: "Changer de langue (L)", formula: "Formule",
        mandelbrot: "MANDELBROT", julia: "ENSEMBLE DE JULIA", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "Qu'est-ce qu'un fractal ? 🌀", fractal_desc: "Un fractal est une merveille mathématique. Imaginez une image dans laquelle vous pouvez zoomer à l'infini, et de nouveaux motifs magnifiques apparaissent sans cesse, ressemblant à l'ensemble.",
        magic_formula: "La formule magique : z = z² + c ✨", magic_desc: "Vous prenez un nombre (z), vous le multipliez par lui-même (z²) et vous ajoutez un nombre fixe (c). Vous prenez ensuite le résultat comme nouveau (z) et vous répétez le processus.",
        why_black: "Pourquoi le 'petit homme' est-il noir ? 🌑", trapped: "Piégé", trapped_desc: "Le nombre reste petit et continue d'orbiter. Ces points appartiennent au fractal et nous les peignons en noir.",
        escape: "Évasion", escape_desc: "Le nombre devient énorme et s'envole vers l'infini comme une fusée !",
        color_origin: "D'où viennent les couleurs ? 🌈", color_desc: "Les couleurs nous montrent à quelle vitesse un nombre s'est 'évadé'. Un nombre qui devient énorme après seulement 3 étapes obtient une couleur différente de celui qui en a pris 100.",
        controls: "Contrôles 🎮", ctrl_scroll: "Faites défiler pour zoomer.", ctrl_drag: "Cliquez et faites glisser pour déplacer.", ctrl_shift: "Maj + glisser pour la sélection du zoom.", ctrl_keys: "Flèches pour déplacer, +/− pour les détails."
    },
    pt: {
        title: "Explorador de Fractais", re: "Re", im: "Im", zoom: "Zoom", iterations: "Iterações", mode: "Modo", fps: "FPS", version: "Versão",
        reset_view: "Redefinir visualização (R)", screenshot: "Captura de tela (S)", fullscreen: "Tela cheia (F)", zoom_mode: "Modo de zoom (Z)", change_mode: "Mudar modo (M)", help: "O que é um fractal? (?)", toggle_info: "Alternar informações (I)", change_lang: "Mudar idioma (L)", formula: "Fórmula",
        mandelbrot: "MANDELBROT", julia: "CONJUNTO DE JULIA", burning_ship: "BURNING SHIP", tricorn: "TRICORN", mandel_z3: "MANDELBROT z³", newton: "NEWTON", mandelbulb: "MANDELBULB 3D", buddhabrot: "BUDDHABROT",
        what_is_fractal: "O que é um fractal? 🌀", fractal_desc: "Um fractal é uma maravilha matemática. Imagine uma imagem na qual você pode fazer zoom infinitamente, e novos e belos padrões continuam aparecendo, assemelhando-se ao todo.",
        magic_formula: "A fórmula mágica: z = z² + c ✨", magic_desc: "Você pega um número (z), multiplica-o por si mesmo (z²) e adiciona um número fixo (c). Depois pega o resultado como o novo (z) e repete o processo.",
        why_black: "Por que o 'homem-biscoito' é preto? 🌑", trapped: "Preso", trapped_desc: "O número permanece pequeno e continua 'orbitando'. Esses pontos pertencem ao fractal e nós os pintamos de preto.",
        escape: "Fuga", escape_desc: "O número torna-se enorme e dispara para o infinito como um foguete!",
        color_origin: "De onde vêm as cores? 🌈", color_desc: "As cores mostram-nos quão rápido um número 'escapou'. Um número que se torna enorme após apenas 3 passos ganha uma cor diferente de um que levou 100 passos.",
        controls: "Controlos 🎮", ctrl_scroll: "Role para ampliar e reduzir.", ctrl_drag: "Clique e arraste para mover.", ctrl_shift: "Shift + arrastar para seleção de zoom.", ctrl_keys: "Setas para mover, +/− para detalhes."
    },
    zh: {
        title: "分形浏览器", re: "实部", im: "虚部", zoom: "缩放", iterations: "迭代次数", mode: "模式", fps: "帧率", version: "版本",
        reset_view: "重置视图 (R)", screenshot: "截图 (S)", fullscreen: "全屏 (F)", zoom_mode: "缩放模式 (Z)", change_mode: "切换模式 (M)", help: "什么是分形? (?)", toggle_info: "切换信息 (I)", change_lang: "切换语言 (L)", formula: "公式",
        mandelbrot: "曼德博集合", julia: "朱利亚集合", burning_ship: "燃烧船", tricorn: "三尖角", mandel_z3: "曼德博 z³", newton: "牛顿分形", mandelbulb: "分形球 3D", buddhabrot: "佛像分形",
        what_is_fractal: "什么是分形? 🌀", fractal_desc: "分形是一个数学奇迹。想象一下一张可以无限缩放的图片，不断出现与整体相似的新奇而美丽的图案。",
        magic_formula: "神奇公式: z = z² + c ✨", magic_desc: "你取一个数 (z)，将它与自身相乘 (z²)，然后加上一个固定的数 (c)。接着将结果作为新的 (z) 并重复此过程。",
        why_black: "为什么“小人”是黑色的? 🌑", trapped: "被捕获", trapped_desc: "数值保持较小并不断“轨道运行”。这些点属于分形，我们将它们涂成黑色。",
        escape: "逃逸", escape_desc: "数值变得巨大，并像火箭一样冲向无穷大！",
        color_origin: "五彩缤纷的颜色从何而来? 🌈", color_desc: "颜色向我们展示了一个数值“逃逸”的速度。仅经过3步就变得巨大的数值会获得与经过100步才逃逸的数值不同的颜色。",
        controls: "控制 🎮", ctrl_scroll: "滚动以放大和缩小。", ctrl_drag: "点击并拖动以平移。", ctrl_shift: "Shift + 拖动以选择缩放区域。", ctrl_keys: "方向键移动，+/− 查看细节。"
    },
    ja: {
        title: "フラクタル・エクスプローラー", re: "実部", im: "虚部", zoom: "拡大", iterations: "反復回数", mode: "モード", fps: "FPS", version: "バージョン",
        reset_view: "リセット (R)", screenshot: "スクリーンショット (S)", fullscreen: "全画面 (F)", zoom_mode: "拡大モード (Z)", change_mode: "モード切替 (M)", help: "フラクタルとは？ (?)", toggle_info: "情報表示 (I)", change_lang: "言語切替 (L)", formula: "数式",
        mandelbrot: "マンデルブロ集合", julia: "ジュリア集合", burning_ship: "バーニング・シップ", tricorn: "トライコーン", mandel_z3: "マンデルブロ z³", newton: "ニュートン近似", mandelbulb: "マンデルバルブ 3D", buddhabrot: "ブッダブロ",
        what_is_fractal: "フラクタルとは？ 🌀", fractal_desc: "フラクタルは数学的な驚異です。無限に拡大できる画像を想像してください。全体と似た、新しく美しいパターンが次々と現れます。",
        magic_formula: "魔法の数式: z = z² + c ✨", magic_desc: "ある数 (z) を取り、それを自乗 (z²) し、一定の数 (c) を加えます。その結果を新しい (z) として、このプロセスを繰り返します。",
        why_black: "なぜ「マンデルブロ」は黒いの？ 🌑", trapped: "囚われ", trapped_desc: "数値が小さいまま「軌道」を回り続けます。これらの点はフラクタルに属し、黒く塗られます。",
        escape: "脱出", escape_desc: "数値が巨大になり、ロケットのように無限へと飛んでいきます！",
        color_origin: "鮮やかな色はどこから来るの？ 🌈", color_desc: "色は、数値がいかに速く「脱出」したかを示しています。わずか3ステップで巨大になった数値は、100ステップかかった数値とは異なる色になります。",
        controls: "操作方法 🎮", ctrl_scroll: "スクロールで拡大・縮小。", ctrl_drag: "ドラッグで移動。", ctrl_shift: "Shift + ドラッグで範囲拡大。", ctrl_keys: "矢印キーで移動、+/− で詳細度変更。"
    },
    ko: {
        title: "프랙탈 탐험가", re: "실수", im: "허수", zoom: "확대", iterations: "반복", mode: "모드", fps: "FPS", version: "버전",
        reset_view: "보기 초기화 (R)", screenshot: "스크린샷 (S)", fullscreen: "전체 화면 (F)", zoom_mode: "확대 모드 (Z)", change_mode: "모드 전환 (M)", help: "프랙탈이란? (?)", toggle_info: "정보 토글 (I)", change_lang: "언어 전환 (L)", formula: "공식",
        mandelbrot: "망델브로 집합", julia: "줄리아 집합", burning_ship: "버닝 쉽", tricorn: "트라이콘", mandel_z3: "망델브로 z³", newton: "뉴턴 프랙탈", mandelbulb: "망델벌브 3D", buddhabrot: "부다브로",
        what_is_fractal: "프랙탈이란? 🌀", fractal_desc: "프랙탈은 수학적 경이로움입니다. 무한히 확대할 수 있는 이미지를 상상해 보세요. 전체와 닮은 새롭고 아름다운 패턴이 계속해서 나타납니다.",
        magic_formula: "마법의 공식: z = z² + c ✨", magic_desc: "어떤 수 (z)를 가져와 자신과 곱하고 (z²) 고정된 수 (c)를 더합니다. 그 결과를 새로운 (z)로 삼아 이 과정을 반복합니다.",
        why_black: "왜 '망델브로'는 검은색인가요? 🌑", trapped: "갇힘", trapped_desc: "수치가 작게 유지되며 계속 '궤도'를 돕니다. 이 점들은 프랙탈에 속하며 검은색으로 칠해집니다.",
        escape: "탈출", escape_desc: "수치가 거대해져 로켓처럼 무한대로 날아갑니다!",
        color_origin: "화려한 색상은 어디에서 오나요? 🌈", color_desc: "색상은 수치가 얼마나 빨리 '탈출'했는지를 보여줍니다. 단 3단계 만에 거대해진 수치는 100단계가 걸린 수치와 다른 색상을 갖게 됩니다.",
        controls: "컨트롤 🎮", ctrl_scroll: "스크롤하여 확대 및 축소.", ctrl_drag: "클릭하고 드래그하여 이동.", ctrl_shift: "Shift + 드래그하여 영역 확대.", ctrl_keys: "방향키로 이동, +/−로 상세 정보 조절."
    }
};
