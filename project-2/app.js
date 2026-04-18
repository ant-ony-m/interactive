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
// --- UPDATED TRACKING & DRAWING ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    // 1. SET UP THE PERMANENT DRAWING LOOP
    // This runs independently of the AI so dots NEVER disappear
    function mainLoop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Always draw calibration dots
        drawCalibration(ctx);
        
        // Draw the player marker if we have current data
        if (p1.currentX && p1.currentY) {
            drawPlayerMarker(ctx, p1);
        }
        if (p2.currentX && p2.currentY) {
            drawPlayerMarker(ctx, p2);
        }

        requestAnimationFrame(mainLoop);
    }
    requestAnimationFrame(mainLoop);

    // 2. START CAMERA
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "environment", width: 640, height: 480 } 
        });
        video.srcObject = stream;
        await video.play();
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const camera = new Camera(video, {
            onFrame: async () => {
                await pose.send({ image: video });
            },
            width: video.videoWidth,
            height: video.videoHeight
        });
        camera.start();
    } catch (err) {
        console.error("Camera failed:", err);
    }

    // 3. AI LOGIC (Updates data, doesn't handle drawing)
    pose.onResults((results) => {
        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;
            const midX = ((landmarks[27].x + landmarks[28].x) / 2) * canvas.width;
            const midY = ((landmarks[27].y + landmarks[28].y) / 2) * canvas.height;

            const distP1 = Math.hypot(midX - p1.x, midY - p1.y);
            const distP2 = Math.hypot(midX - p2.x, midY - p2.y);

            let activePlayer = distP1 < distP2 ? p1 : p2;
            
            // Store coordinates for the mainLoop to draw
            activePlayer.currentX = midX;
            activePlayer.currentY = midY;
            activePlayer.x = midX; // Update last known for distance check
            activePlayer.y = midY;

            if (isRecording && homographyMatrix) {
                const courtPos = mapToCourt(midX, midY);
                rallyData.push({
                    player: activePlayer.label,
                    x: courtPos.x,
                    y: courtPos.y,
                    color: activePlayer.color,
                    time: Date.now()
                });
                drawLiveAnimation(courtPos.x, courtPos.y, activePlayer.color);
            }
        }
    });

    // 4. CLICK HANDLER
    canvas.onclick = (e) => {
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            const x = (e.clientX - rect.left) * (canvas.width / rect.width);
            const y = (e.clientY - rect.top) * (canvas.height / rect.height);
            srcPoints.push(x, y);
            console.log("Point added:", x, y); // Check console on phone if possible
            
            if (srcPoints.length === 8) {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
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