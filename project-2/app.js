// --- GLOBALS ---
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = [];
let p1 = { x: 100, y: 100, currentX: null, currentY: null, color: "#00ffff", label: "P1" };
let p2 = { x: 500, y: 400, currentX: null, currentY: null, color: "#ff00ff", label: "P2" };
const courtWidth = 210, courtHeight = 320;
const cornerLabels = ["Front Left", "Front Right", "Back Right", "Back Left"];

// --- NAVIGATION ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goToCamera() {
    showScreen("camera");
    startCamera();
}

function goHome() { location.reload(); }

// --- AI SETUP ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});
pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5 });

// --- CAMERA LOGIC ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    const setCanvasSize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };

    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Draw Gold Dots
        for (let i = 0; i < srcPoints.length / 2; i++) {
            const x = srcPoints[i * 2], y = srcPoints[i * 2 + 1];
            ctx.fillStyle = "gold";
            ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
        }
        // Draw Player Trackers
        [p1, p2].forEach(p => {
            if (p.currentX && p.currentY) {
                ctx.fillStyle = p.color;
                ctx.beginPath(); ctx.arc(p.currentX, p.currentY, 15, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = "white"; ctx.lineWidth = 3; ctx.stroke();
            }
        });
        requestAnimationFrame(render);
    }

    try {
        const constraints = {
            video: { facingMode: { ideal: "environment" }, width: 1280, height: 720 }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        await video.play();

        setCanvasSize();
        window.addEventListener('resize', setCanvasSize);
        render();

        const camera = new Camera(video, {
            onFrame: async () => { await pose.send({ image: video }); },
            width: 640, height: 360
        });
        camera.start();
    } catch (err) {
        console.error("Camera fail:", err);
    }

    pose.onResults((results) => {
        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;
            const mx = ((landmarks[27].x + landmarks[28].x) / 2) * canvas.width;
            const my = ((landmarks[27].y + landmarks[28].y) / 2) * canvas.height;

            const d1 = Math.hypot(mx - p1.x, my - p1.y);
            const d2 = Math.hypot(mx - p2.x, my - p2.y);
            let active = d1 < d2 ? p1 : p2;

            active.currentX = mx;
            active.currentY = my;
            active.x = mx;
            active.y = my;

            if (isRecording && homographyMatrix) {
                const courtPos = mapToCourt(mx, my);
                rallyData.push({ player: active.label, x: courtPos.x, y: courtPos.y, color: active.color });
                drawLiveAnimation(courtPos.x, courtPos.y, active.color);
            }
        }
    });

    canvas.onclick = (e) => {
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            srcPoints.push(
                (e.clientX - rect.left) * (canvas.width / rect.width),
                (e.clientY - rect.top) * (canvas.height / rect.height)
            );
            if (srcPoints.length === 8) {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
            }
        }
    };
}

function resetCalibration() {
    srcPoints = [];
    homographyMatrix = null;
    p1.currentX = null; p1.currentY = null;
    p2.currentX = null; p2.currentY = null;
    document.getElementById("startTrackBtn").disabled = true;
}

function calculateHomography() {
    const srcCoords = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    const dstCoords = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcCoords, dstCoords);
}

function mapToCourt(vx, vy) {
    const pt = cv.matFromArray(3, 1, cv.CV_64FC1, [vx, vy, 1]);
    const out = new cv.Mat();
    cv.gemm(homographyMatrix, pt, 1, new cv.Mat(), 0, out);
    return { x: out.data64F[0] / out.data64F[2], y: out.data64F[1] / out.data64F[2] };
}

function drawLiveAnimation(x, y, color) {
    const cCtx = document.getElementById("courtCanvas").getContext("2d");
    cCtx.fillStyle = color;
    cCtx.beginPath(); cCtx.arc(x, y, 3, 0, Math.PI * 2); cCtx.fill();
}

function startCapture() { rallyData = []; isRecording = true; showScreen("edit"); }
function stopRecording() { isRecording = false; renderFinalProduct(); }

function renderFinalProduct() {
    const ctx = document.getElementById("courtCanvas").getContext("2d");
    ctx.clearRect(0, 0, courtWidth, courtHeight);
    rallyData.forEach((p, i) => {
        setTimeout(() => {
            ctx.fillStyle = p.color;
            ctx.globalAlpha = 0.2;
            ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        }, i * 5);
    });
}

// Expose functions globally for HTML buttons
window.goToCamera = goToCamera;
window.goHome = goHome;
window.goToAbout = goToAbout;
window.goToPast = goToPast;
window.startCapture = startCapture;
window.stopRecording = stopRecording;