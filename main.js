// 1. 초기 테마 설정
(function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark-mode');
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    const analyzeBtn = document.getElementById('analyze-btn');
    const graphBtn = document.getElementById('graph-btn');
    const themeToggle = document.getElementById('theme-toggle');
    const resultsDisplay = document.getElementById('results-display');
    const graphContainer = document.getElementById('graph-container');
    const resultsContent = document.getElementById('results-content');
    const resP1 = document.getElementById('res-p1');
    let myChart = null;

    // 테마 토글
    themeToggle.addEventListener('click', () => {
        const isDark = document.documentElement.classList.toggle('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });

    // 핵심 물리 모델 (Python _get_dp 로직 이식)
    function getDP(d, soot_gL, ash_gL) {
        const tortuosity = 1.8;
        const k1_internal = 0.4;
        
        const amb_pa = d.amb_kpa * 1000.0;
        const porosity = d.porosity_pct / 100.0;
        const w_m = d.width_mm / 1000, h_m = d.height_mm / 1000, l_m = d.depth_mm / 1000;
        const t_kelvin = d.temp_c + 273.15;
        
        // rho_air = P / (R * T)
        const rho_air = amb_pa / (287.05 * t_kelvin);
        // mu (viscosity) - Sutherland's Law
        const mu = 1.81e-5 * Math.pow((t_kelvin / 293.15), 1.5) * ((293.15 + 110.4) / (t_kelvin + 110.4));
        const cms = d.cmm / 60.0;
        
        const volume_m3 = w_m * h_m * l_m;
        // a_eff (effective area) calculation
        const a_eff = volume_m3 * (2800 * (Math.sqrt(d.cpsi) / Math.sqrt(400)));
        
        // Permeability of clean wall
        const kappa_clean = (Math.pow(d.pore_size_um * 1e-6, 2) * Math.pow(porosity, 3)) / (180 * Math.pow(1 - porosity, 2)) / tortuosity;
        const reduction_factor = Math.exp(-k1_internal * (soot_gL + ash_gL));
        const kappa_effective = kappa_clean * reduction_factor;
        
        const v_wall = cms / a_eff;
        const dp_wall = (mu * v_wall * (d.wall_mil * 0.0000254)) / kappa_effective;
        
        const total_load_kg = ((soot_gL + ash_gL) * (volume_m3 * 1000)) / 1000;
        const cake_thick = total_load_kg / (100.0 * a_eff);
        const dp_cake = cake_thick > 0 ? (mu * v_wall * cake_thick) / parseFloat(d.k2) : 0;
        
        const area_dpf = w_m * h_m;
        const area_pipe = Math.PI * Math.pow(d.pipe_dia_mm / 2000, 2);
        const v_pipe = cms / area_pipe;
        const angle_rad = d.cone_angle_deg * (Math.PI / 180);
        const k_contraction = 0.5 * Math.sin(angle_rad / 2);
        
        const dp_exit = (k_contraction + 1.0) * 0.5 * rho_air * Math.pow(v_pipe, 2);
        const dp_housing_in = 0.5 * 0.5 * rho_air * Math.pow(cms / area_dpf, 2);
        
        return dp_wall + dp_cake + dp_exit + dp_housing_in;
    }

    function getInputs() {
        try {
            return {
                weight_clean: parseFloat(document.getElementById('weight_clean').value),
                weight_soot_loaded: parseFloat(document.getElementById('weight_soot_loaded').value),
                weight_after_regen: parseFloat(document.getElementById('weight_after_regen').value),
                cmm: parseFloat(document.getElementById('cmm').value),
                temp_c: parseFloat(document.getElementById('temp_c').value),
                amb_kpa: parseFloat(document.getElementById('amb_kpa').value),
                width_mm: parseFloat(document.getElementById('width_mm').value),
                height_mm: parseFloat(document.getElementById('height_mm').value),
                depth_mm: parseFloat(document.getElementById('depth_mm').value),
                cpsi: parseFloat(document.getElementById('cpsi').value),
                wall_mil: parseFloat(document.getElementById('wall_mil').value),
                porosity_pct: parseFloat(document.getElementById('porosity_pct').value),
                pore_size_um: parseFloat(document.getElementById('pore_size_um').value),
                k2: document.getElementById('k2').value,
                pipe_dia_mm: parseFloat(document.getElementById('pipe_dia_mm').value),
                cone_len_mm: parseFloat(document.getElementById('cone_len_mm').value),
                cone_angle_deg: parseFloat(document.getElementById('cone_angle_deg').value)
            };
        } catch (e) {
            alert("입력값을 확인해주세요. 모든 항목은 숫자여야 합니다.");
            return null;
        }
    }

    // 상태별 분석하기
    analyzeBtn.addEventListener('click', () => {
        const d = getInputs();
        if (!d) return;

        const vol_L = (d.width_mm * d.height_mm * d.depth_mm) / 1e6;
        const curr_ash_gL = Math.max(0, (d.weight_after_regen - d.weight_clean) * 1000) / vol_L;
        const curr_soot_gL = Math.max(0, (d.weight_soot_loaded - d.weight_after_regen) * 1000) / vol_L;

        const getInfo = (s, a) => {
            const dp = getDP(d, s, a) / 1000.0;
            let p2 = d.amb_kpa - dp;
            let status = "";
            if (p2 < 0) {
                p2 = 0;
                status = " (🚨 측정불가/한계초과)";
            }
            return { dp, p2, status };
        };

        const states = [
            { title: "1. 신품 상태 (Clean)", soot: 0, ash: 0 },
            { title: `2. 현재 로딩 (${curr_soot_gL.toFixed(2)} g/L Soot)`, soot: curr_soot_gL, ash: curr_ash_gL },
            { title: `3. 재생 후 (${curr_ash_gL.toFixed(2)} g/L Ash)`, soot: 0, ash: curr_ash_gL }
        ];

        resP1.textContent = d.amb_kpa.toFixed(3);
        resultsContent.innerHTML = '';
        
        states.forEach(state => {
            const info = getInfo(state.soot, state.ash);
            const card = document.createElement('div');
            card.className = 'result-card';
            card.innerHTML = `
                <strong>${state.title}</strong>
                <p>- 총 차압: ${info.dp.toFixed(3)} kPa</p>
                <p>- 예상 P2: ${info.p2.toFixed(3)} kPa (절대압)${info.status}</p>
            `;
            resultsContent.appendChild(card);
        });

        resultsDisplay.style.display = 'block';
        resultsDisplay.scrollIntoView({ behavior: 'smooth' });
    });

    // 분석 그래프 보기
    graphBtn.addEventListener('click', () => {
        const d = getInputs();
        if (!d) return;

        const vol_L = (d.width_mm * d.height_mm * d.depth_mm) / 1e6;
        const curr_ash_gL = Math.max(0, (d.weight_after_regen - d.weight_clean) * 1000) / vol_L;
        const curr_soot_gL = Math.max(0, (d.weight_soot_loaded - d.weight_after_regen) * 1000) / vol_L;

        const sootRange = [];
        for (let i = 0; i <= 50; i++) sootRange.push(i * 0.2); // 0 to 10 g/L

        const yClean = sootRange.map(s => getDP(d, s, 0) / 1000.0);
        const yAsh = sootRange.map(s => getDP(d, s, curr_ash_gL) / 1000.0);
        const currDP = getDP(d, curr_soot_gL, curr_ash_gL) / 1000.0;

        graphContainer.style.display = 'block';
        if (myChart) myChart.destroy();

        const ctx = document.getElementById('dpfChart').getContext('2d');
        myChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sootRange.map(s => s.toFixed(1)),
                datasets: [
                    {
                        label: '신품 담체 + 출구 손실',
                        data: yClean,
                        borderColor: '#28A745',
                        borderDash: [5, 5],
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: `현재 Ash (${curr_ash_gL.toFixed(2)}g/L) 포함`,
                        data: yAsh,
                        borderColor: '#007BFF',
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: '석션 한계 (대기압)',
                        data: sootRange.map(() => d.amb_kpa),
                        borderColor: 'red',
                        borderDash: [2, 2],
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: '현재 로딩 지점',
                        data: [{ x: curr_soot_gL.toFixed(2), y: currDP }],
                        backgroundColor: 'red',
                        borderColor: 'red',
                        pointRadius: 6,
                        showLine: false
                    }
                ]
            },
            options: {
                responsive: true,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        title: { display: true, text: 'Soot Loading (g/L)' },
                        type: 'linear',
                        min: 0,
                        max: 10
                    },
                    y: {
                        title: { display: true, text: 'Total Pressure Drop (kPa)' },
                        beginAtZero: true
                    }
                }
            }
        });
        graphContainer.scrollIntoView({ behavior: 'smooth' });
    });
});
