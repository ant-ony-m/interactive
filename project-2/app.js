// --- GLOBALS ---
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; 

let p1 = { x: 160, y: 240, color: "#00ffff", label: "P1" };
let p2 = { x: 480, y: 240, color: "#ff00ff", label: "P2" };

const courtWidth = 210, courtHeight = 320;
const cornerLabels = ["Front Left", "Front Right", "Back Right", "Back Left"];

// --- NAVIGATION & UI ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goToCamera() { 
    showScreen("camera"); 
    startCamera(); 
}

function goHome() { location.reload(); }
function goToAbout() { alert("Ghost - Squash Movement Visualizer project."); }
function goToPast() { alert("Past rallies feature coming soon!"); }

// --- SCROLL & UI ANIMATIONS ---
window.addEventListener("scroll", () => {
    const scroll = window.scrollY;
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");
    if (ball) ball.style.transform = `translateY(${scroll * 0.8}px) rotate(${scroll}deg)`;
    if (scroll > 600 && cta) cta.classList.add("visible");
});

// --- INITIALIZE MEDIAPIPE ---
const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
});

pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

// --- CAMERA & TRACKING ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    // 1. PERMANENT RENDER LOOP
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw Gold Calibration Dots
        for (let i = 0; i < srcPoints.length / 2; i++) {
            const x = srcPoints[i * 2], y = srcPoints[i * 2 + 1];
            ctx.fillStyle = "gold";
            ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "white";
            ctx.font = "bold 14px Lexend";
            ctx.fillText(cornerLabels[i] || "", x + 12, y + 5);
        }
        
        // Draw Player markers
        [p1, p2].forEach(p => {
            if (p.currentX && p.currentY) {
                ctx.fillStyle = p.color;
                ctx.beginPath(); ctx.arc(p.currentX, p.currentY, 12, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = "white";
                ctx.lineWidth = 2; ctx.stroke();
            }
        });
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);

    // 2. HARD-FORCE BACK CAMERA & 16:9 RATIO
    const constraints = {
        video: {
            facingMode: { exact: "environment" },
            // Most phone back cameras are optimized for 1280x720 (16:9)
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    try {
        if (video.srcObject) {
            video.srcObject.getTracks().forEach(track => track.stop());
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        video.setAttribute("playsinline", true);
        video.muted = true;
        await video.play();

        // 3. AUTO-ADAPT CANVAS TO VIDEO RATIO
        // This ensures your taps and the AI tracking match the pixels perfectly
        const setCanvasSize = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
        };
        setCanvasSize();
        // Re-check size if the phone orientation changes
        window.addEventListener('resize', setCanvasSize);

        const camera = new Camera(video, {
            onFrame: async () => {
                await pose.send({ image: video });
            },
            width: video.videoWidth,
            height: video.videoHeight
        });
        camera.start();

    } catch (err) {
        console.warn("Back camera blocked or not found:", err);
        alert("Please turn your phone to LANDSCAPE and ensure camera permissions are allowed.");
    }

    // 4. AI TRACKING (Fixed Logic)
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
                rallyData.push({
                    player: active.label,
                    x: courtPos.x,
                    y: courtPos.y,
                    color: active.color
                });
                drawLiveAnimation(courtPos.x, courtPos.y, active.color);
            }
        }
    });

    // 5. CALIBRATION CLICK HANDLER (Scaled for Aspect Ratio)
    canvas.onclick = (e) => {
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            // Scaling logic: converts screen-tap-pixels to video-stream-pixels
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            
            srcPoints.push(
                (e.clientX - rect.left) * scaleX,
                (e.clientY - rect.top) * scaleY
            );

            if (srcPoints.length === 8) {
                calculateHomography();
                const btn = document.getElementById("startTrackBtn");
                if (btn) btn.disabled = false;
            }
        }
    };
}

// Helper to keep drawing clean
function drawPlayerMarker(ctx, player) {
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(player.currentX, player.currentY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
}

// --- UTILS & MATH ---
function drawCalibration(ctx) {
    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];
        ctx.fillStyle = "gold";
        ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = "bold 14px Lexend";
        ctx.fillText(cornerLabels[i], x + 12, y + 5);
    }
}

function resetCalibration() {
    // 1. Clear the calibration points array
    srcPoints = [];
    
    // 2. Destroy the homography matrix to stop mapping
    homographyMatrix = null;
    
    // 3. Clear player "current" positions so the markers vanish
    p1.currentX = null; p1.currentY = null;
    p2.currentX = null; p2.currentY = null;
    
    // 4. Reset the UI buttons and instructions
    const startBtn = document.getElementById("startTrackBtn");
    if (startBtn) startBtn.disabled = true;
    
    const inst = document.getElementById("instruction");
    if (inst) inst.innerText = "Tap the 4 corners of the court";
    
    // 5. Clear the court heatmap canvas
    const cCanvas = document.getElementById("courtCanvas");
    const cCtx = cCanvas.getContext("2d");
    cCtx.clearRect(0, 0, courtWidth, courtHeight);

    console.log("Calibration reset successfully.");
}

function calculateHomography() {
    if (typeof cv === 'undefined' || !cv.matFromArray) return alert("OpenCV is still loading...");
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
    const cCanvas = document.getElementById("courtCanvas");
    const cCtx = cCanvas.getContext("2d");
    cCtx.fillStyle = "rgba(0,0,0,0.01)";
    cCtx.fillRect(0, 0, courtWidth, courtHeight);
    cCtx.fillStyle = color;
    cCtx.beginPath(); cCtx.arc(x, y, 3, 0, Math.PI * 2); cCtx.fill();
}

function startCapture() { rallyData = []; isRecording = true; showScreen("edit"); }
function stopRecording() { isRecording = false; renderFinalProduct(); }

function renderFinalProduct() {
    const canvas = document.getElementById("courtCanvas");
    const ctx = canvas.getContext("2d");
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