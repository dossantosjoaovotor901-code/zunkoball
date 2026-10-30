/* maps.js - definição dos campos (MAPS.classic, v1, v2, v3, v4): dimensões, física, bola, gols.
   Só dados + a função makeFieldVariant que gera os campos 1v1..4v4. */
const MAPS = {
    "classic": {
        "name": "Cl\u00e1ssico",
        "cameraZoomRatio": 0.75,
        "lineWidth": 0.005,
        "BallAreaSettings": {
            "style": "grass",
            "width": 16.0,
            "height": 9.0,
            "verticalMargin": 1.5,
            "horizontalMargin": 2.0,
            "Line": [{
                "x1": 5.0,
                "y1": 4.5,
                "x2": 21.0,
                "y2": 4.5
            }, {
                "x1": 5.0,
                "y1": 13.5,
                "x2": 21.0,
                "y2": 13.5
            }, {
                "x1": 5.0,
                "y1": 4.5,
                "x2": 5.0,
                "y2": 6.3890625
            }, {
                "x1": 5.0,
                "y1": 11.6109375,
                "x2": 5.0,
                "y2": 13.5
            }, {
                "x1": 21.0,
                "y1": 4.5,
                "x2": 21.0,
                "y2": 6.3890625
            }, {
                "x1": 21.0,
                "y1": 11.6109375,
                "x2": 21.0,
                "y2": 13.5
            }]
        },
        "PlayerAreaSettings": {
            "width": 26.0,
            "height": 18.0,
            "style": "718C5A"
        },
        "middleFieldAreaSettings": {
            "style": "mid_field",
            "needMiddleFieldPhysic": 1,
            "middleAreaRadius": 1.3
        },
        "PlayerForbiddenZoneLine": {
            "lineWidth": 0.03,
            "ForbiddenLine": []
        },
        "PlayerProperty": {
            "impulse": 0.02,
            "impulseWithKick": 0.40,
            "density": 16.5,
            "restitution": 0.0,
            "damping": 0.0,
            "friction": 0.2
        },
        "BallProperty": {
            "radius": 0.25,
            "density": 1800,
            "restitution": 0.23,
            "damping": 0.8,
            "friction": 0.3,
            "ballPower": 0.0
        },
        "GoalProperty": {
            "GoalSettings": {
                "GoalDept": 1.12,
                "PostRadius": 0.15158,
                "lineSize": 0.05
            },
            "GoalLine": [{
                "x1": 5.0,
                "y1": 6.90015625,
                "x2": 5.0,
                "y2": 11.59984375,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 21.0,
                "y1": 6.90015625,
                "x2": 21.0,
                "y2": 11.59984375,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }]
        }
    },
    "big": {
        "name": "Grande",
        "cameraZoomRatio": 0.7,
        "lineWidth": 0.005,
        "BallAreaSettings": {
            "style": "grass",
            "width": 10.232484,
            "height": 5.90625,
            "verticalMargin": 0.5,
            "horizontalMargin": 1.0,
            "Line": [{
                "x1": 1.0,
                "y1": 0.5,
                "x2": 11.232484,
                "y2": 0.5
            }, {
                "x1": 1.0,
                "y1": 6.40625,
                "x2": 11.232484,
                "y2": 6.40625
            }, {
                "x1": 1.0,
                "y1": 0.5,
                "x2": 1.0,
                "y2": 2.453125
            }, {
                "x1": 1.0,
                "y1": 4.453125,
                "x2": 1.0,
                "y2": 6.90625
            }, {
                "x1": 11.232484,
                "y1": 0.5,
                "x2": 11.232484,
                "y2": 2.453125
            }, {
                "x1": 11.232484,
                "y1": 4.453125,
                "x2": 11.232484,
                "y2": 6.90625
            }]
        },
        "PlayerAreaSettings": {
            "width": 12.232484,
            "height": 6.90625,
            "style": "718C5A"
        },
        "middleFieldAreaSettings": {
            "style": "mid_field",
            "needMiddleFieldPhysic": 1,
            "middleAreaRadius": 1.2
        },
        "PlayerForbiddenZoneLine": {
            "lineWidth": 0.03,
            "ForbiddenLine": []
        },
        "PlayerProperty": {
            "impulse": 0.02,
            "impulseWithKick": 0.40,
            "density": 16.5,
            "restitution": 0.0,
            "damping": 0.0,
            "friction": 0.2
        },
        "BallProperty": {
            "radius": 0.25,
            "density": 1800,
            "restitution": 0.23,
            "damping": 0.8,
            "friction": 0.3,
            "ballPower": 0.0
        },
        "GoalProperty": {
            "GoalSettings": {
                "GoalDept": 0.94,
                "PostRadius": 0.1166,
                "lineSize": 0.05
            },
            "GoalLine": [{
                "x1": 1.0,
                "y1": 2.803125,
                "x2": 1.0,
                "y2": 4.603125,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 11.232484,
                "y1": 2.803125,
                "x2": 11.232484,
                "y2": 4.603125,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }]
        }
    },
    "huge": {
        "name": "Enorme",
        "cameraZoomRatio": 0.6,
        "lineWidth": 0.005,
        "BallAreaSettings": {
            "style": "grass",
            "width": 11.73,
            "height": 6.9,
            "verticalMargin": 0.5,
            "horizontalMargin": 1.0,
            "Line": [{
                "x1": 1.0,
                "y1": 0.5,
                "x2": 12.73,
                "y2": 0.5
            }, {
                "x1": 1.0,
                "y1": 7.4,
                "x2": 12.73,
                "y2": 7.4
            }, {
                "x1": 1.0,
                "y1": 0.5,
                "x2": 1.0,
                "y2": 2.95
            }, {
                "x1": 1.0,
                "y1": 4.95,
                "x2": 1.0,
                "y2": 7.4
            }, {
                "x1": 12.73,
                "y1": 0.5,
                "x2": 12.73,
                "y2": 2.95
            }, {
                "x1": 12.73,
                "y1": 4.95,
                "x2": 12.73,
                "y2": 7.4
            }]
        },
        "PlayerAreaSettings": {
            "width": 13.73,
            "height": 7.9,
            "style": "718C5A"
        },
        "middleFieldAreaSettings": {
            "style": "mid_field",
            "needMiddleFieldPhysic": 1,
            "middleAreaRadius": 1.2
        },
        "PlayerForbiddenZoneLine": {
            "lineWidth": 0.03,
            "ForbiddenLine": []
        },
        "PlayerProperty": {
            "impulse": 0.02,
            "impulseWithKick": 0.40,
            "density": 16.5,
            "restitution": 0.0,
            "damping": 0.0,
            "friction": 0.2
        },
        "BallProperty": {
            "radius": 0.25,
            "density": 1800,
            "restitution": 0.23,
            "damping": 0.8,
            "friction": 0.3,
            "ballPower": 0.0
        },
        "GoalProperty": {
            "GoalSettings": {
                "GoalDept": 0.94,
                "PostRadius": 0.1166,
                "lineSize": 0.05
            },
            "GoalLine": [{
                "x1": 1.0,
                "y1": 3.3000000000000003,
                "x2": 1.0,
                "y2": 5.1000000000000005,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 12.73,
                "y1": 3.3000000000000003,
                "x2": 12.73,
                "y2": 5.1000000000000005,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }]
        }
    },
    "sniper": {
        "name": "Sniper",
        "cameraZoomRatio": 0.88,
        "lineWidth": 0.005,
        "BallAreaSettings": {
            "style": "grass",
            "width": 7.0,
            "height": 4.0,
            "verticalMargin": 0.5,
            "horizontalMargin": 1.0,
            "Line": [{
                "x1": 1,
                "y1": 0.5,
                "x2": 8,
                "y2": 0.5
            }, {
                "x1": 1,
                "y1": 4.5,
                "x2": 8,
                "y2": 4.5
            }, {
                "x1": 1,
                "y1": 0.5,
                "x2": 1,
                "y2": 0.95
            }, {
                "x1": 1,
                "y1": 1.3,
                "x2": 1,
                "y2": 1.75
            }, {
                "x1": 1,
                "y1": 3.25,
                "x2": 1,
                "y2": 3.7
            }, {
                "x1": 1,
                "y1": 4.05,
                "x2": 1,
                "y2": 4.5
            }, {
                "x1": 8,
                "y1": 0.5,
                "x2": 8,
                "y2": 0.95
            }, {
                "x1": 8,
                "y1": 1.3,
                "x2": 8,
                "y2": 1.75
            }, {
                "x1": 8,
                "y1": 3.25,
                "x2": 8,
                "y2": 3.7
            }, {
                "x1": 8,
                "y1": 4.05,
                "x2": 8,
                "y2": 4.5
            }]
        },
        "PlayerAreaSettings": {
            "width": 9.0,
            "height": 5.0,
            "style": "718C5A"
        },
        "middleFieldAreaSettings": {
            "style": "mid_field",
            "needMiddleFieldPhysic": 0,
            "middleAreaRadius": 0.9
        },
        "PlayerForbiddenZoneLine": {
            "lineWidth": 0.03,
            "ForbiddenLine": [{
                "x1": 3.7,
                "y1": 0,
                "x2": 3.7,
                "y2": 5,
                "allowFor": "red",
                "style": "0000FF"
            }, {
                "x1": 5.3,
                "y1": 0,
                "x2": 5.3,
                "y2": 5,
                "allowFor": "blue",
                "style": "FF0000"
            }]
        },
        "PlayerProperty": {
            "impulse": 1.35,
            "impulseWithKick": 0.95,
            "density": 16.5,
            "restitution": 0.0,
            "damping": 0.0,
            "friction": 0.2
        },
        "BallProperty": {
            "radius": 0.22,
            "density": 3.8,
            "restitution": 0.2,
            "damping": 0.8,
            "friction": 0.3,
            "ballPower": 0.55
        },
        "GoalProperty": {
            "GoalSettings": {
                "GoalDept": 0.76,
                "PostRadius": 0.1,
                "lineSize": 0.04
            },
            "GoalLine": [{
                "x1": 1,
                "y1": 1.175,
                "x2": 1,
                "y2": 1.675,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 1,
                "y1": 2.1,
                "x2": 1,
                "y2": 3.4,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 1,
                "y1": 3.824,
                "x2": 1,
                "y2": 4.324,
                "degree": 0.0,
                "style": "red_post",
                "team": 1
            }, {
                "x1": 8,
                "y1": 1.175,
                "x2": 8,
                "y2": 1.675,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }, {
                "x1": 8,
                "y1": 2.1,
                "x2": 8,
                "y2": 3.4,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }, {
                "x1": 8,
                "y1": 3.824,
                "x2": 8,
                "y2": 4.324,
                "degree": 180.0,
                "style": "blue_post",
                "team": 2
            }]
        }
    }
};
function makeFieldVariant(label, playW, playH, extraX, extraY) {
    const x1 = extraX
      , y1 = extraY
      , x2 = x1 + playW
      , y2 = y1 + playH;
    const goalH = Math.min(playH * .279, 7.2)
      , gy1 = (y1 + y2 - goalH) / 2
      , gy2 = gy1 + goalH;
    return {
        name: label,
        cameraZoomRatio: 0.78,
        lineWidth: .005,
        BallAreaSettings: {
            style: 'grass',
            width: playW,
            height: playH,
            verticalMargin: extraY,
            horizontalMargin: extraX,
            Line: [{
                x1,
                y1,
                x2,
                y2: y1
            }, {
                x1,
                y1: y2,
                x2,
                y2
            }, {
                x1,
                y1,
                x2: x1,
                y2: gy1
            }, {
                x1,
                y1: gy2,
                x2: x1,
                y2
            }, {
                x1: x2,
                y1,
                x2,
                y2: gy1
            }, {
                x1: x2,
                y1: gy2,
                x2,
                y2
            }]
        },
        PlayerAreaSettings: {
            width: x2 + extraX,
            height: y2 + extraY,
            style: '718C5A'
        },
        middleFieldAreaSettings: {
            style: 'mid_field',
            needMiddleFieldPhysic: 1,
            middleAreaRadius: 1.2
        },
        PlayerForbiddenZoneLine: {
            lineWidth: .03,
            ForbiddenLine: []
        },
        PlayerProperty: {
            impulse: 1.35,
            impulseWithKick: 1.05,
            density: 26.0,
            restitution: 0,
            damping: 0,
            friction: .2
        },
        BallProperty: {
            radius: .28,
            density: 220,
            restitution: .23,
            damping: .8,
            friction: .3,
            ballPower: 40.0
        },
        GoalProperty: {
            GoalSettings: {
                GoalDept: Math.max(.90, goalH * .23),
                PostRadius: Math.max(.12, goalH * .045),
                lineSize: Math.max(.06, goalH * .018)
            },
            GoalLine: [{
                x1,
                y1: gy1,
                x2: x1,
                y2: gy2,
                degree: 0,
                style: 'red_post',
                team: 1
            }, {
                x1: x2,
                y1: gy1,
                x2: x2,
                y2: gy2,
                degree: 180,
                style: 'blue_post',
                team: 2
            }]
        }
    }
}
MAPS.v1 = makeFieldVariant('1v1', 24, 14, 3.0, 2.5);
MAPS.v2 = makeFieldVariant('2v2', 30, 17, 3.6, 3.0);
MAPS.v3 = makeFieldVariant('3v3', 44, 25, 4.8, 4.1);
MAPS.v4 = makeFieldVariant('4v4', 52, 29.8, 5.4, 4.85);
// Real Soccer: campos grandes com proporção de futebol de campo.
MAPS.r4 = makeFieldVariant('Real 4v4', 62, 36, 5.8, 4.8);
MAPS.r5 = makeFieldVariant('Real 5v5', 70, 40, 6, 5);
MAPS.r7 = makeFieldVariant('Real 7v7', 84, 50, 6.5, 5.5);
MAPS.r9 = makeFieldVariant('Real 9v9', 96, 60, 7, 6);
MAPS.r11 = makeFieldVariant('Real 11v11', 105, 68, 7.5, 6.5);
// Estilo de jogo de cada mapa: futsal = paredes que fazem a bola quicar; real = bola sai e há reposição.
['v1', 'v2', 'v3', 'v4'].forEach(k => { MAPS[k].style = 'futsal'; });
['r4', 'r5', 'r7', 'r9', 'r11'].forEach(k => {
    const f = MAPS[k];
    f.style = 'real';
    f.BallProperty.damping = .6;      // a bola rola mais, campo é maior
    f.BallProperty.ballPower = 48.0;  // chute com mais alcance
});
// Postes um pouco mais finos, mantendo as dimensões dos modos existentes.
Object.values(MAPS).forEach(field => {
    if (field.GoalProperty?.GoalSettings) {
        field.GoalProperty.GoalSettings.PostRadius *= .45;
        field.GoalProperty.GoalSettings.lineSize *= .45
    }
}
);

/* Catálogo usado pela tela "Criar sala": cada modo de jogo tem sua lista de mapas. */
const MAP_CATALOG = {
    futsal: {
        label: 'Futsal',
        def: 'v3',
        maps: [
            { key: 'v1', name: 'Futsal 1v1', team: 1 },
            { key: 'v2', name: 'Futsal 2v2', team: 2 },
            { key: 'v3', name: 'Futsal 3v3', team: 3 },
            { key: 'v4', name: 'Futsal 4v4', team: 4 }
        ]
    },
    real: {
        label: 'Real Soccer',
        def: 'r4',
        maps: [
            { key: 'r4', name: 'Real 4v4', team: 4 },
            { key: 'r5', name: 'Real 5v5', team: 5 },
            { key: 'r7', name: 'Real 7v7', team: 7 },
            { key: 'r9', name: 'Real 9v9', team: 9 },
            { key: 'r11', name: 'Real 11v11', team: 11 }
        ]
    }
};
function mapLabel(key) {
    for (const k in MAP_CATALOG) {
        const f = MAP_CATALOG[k].maps.find(m => m.key === key);
        if (f) return f.name;
    }
    return String(key || '').toUpperCase();
}

/* Modelos de cor da quadra de futsal (escolhidos na tela "Criar sala"). */
const COURT_THEMES = [
    { key: 'orange', name: 'Verde e laranja', outer: '#2f9a46', outer2: '#278139', court: '#e2672b', court2: '#cf5a22' },
    { key: 'blue',   name: 'Azul',            outer: '#1c4a8a', outer2: '#173d73', court: '#3189de', court2: '#2677c6' },
    { key: 'red',    name: 'Vermelha',        outer: '#8e2b2e', outer2: '#772326', court: '#d8453c', court2: '#c43b33' },
    { key: 'gray',   name: 'Cinza e azul',    outer: '#3b434c', outer2: '#313840', court: '#2d6fd1', court2: '#2660b8' },
    { key: 'wood',   name: 'Madeira',         outer: '#6d4322', outer2: '#5d381b', court: '#d9a066', court2: '#c98f55', wood: true },
    { key: 'grass',  name: 'Gramado',         outer: '#3f7f47', outer2: '#2f6535', court: '#3f7f47', court2: '#2f6535', grass: true }
];
let COURT_KEY = 'orange';
try {
    const saved = localStorage.getItem('mb_futsal_court');
    if (COURT_THEMES.some(t => t.key === saved)) COURT_KEY = saved;
} catch (e) {}
function courtTheme() {
    return COURT_THEMES.find(t => t.key === COURT_KEY) || COURT_THEMES[0];
}
function setCourtKey(k) {
    if (!COURT_THEMES.some(t => t.key === k)) return;
    COURT_KEY = k;
    try { localStorage.setItem('mb_futsal_court', k); } catch (e) {}
}
