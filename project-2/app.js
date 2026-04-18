// --- GLOBALS ---
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; 

// Starting positions (Hypothetical: P1 Left, P2 Right)
let p1 = { x: 160, y: 240, color: "#00ffff", label: "P1", lastActive: 0 };
let p2 = { x: 480, y: 240, color: "#ff00ff", label: "P2", lastActive: 0 };

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

// --- CAMERA & TWO-PLAYER DATA COLLECTION ---
async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: { exact: "environment" }, // Forces the back camera
                width: { ideal: 640 },
                height: { ideal: 480 }
            } 
        });
        video.srcObject = stream;
        
        // The rest remains the same...
        const camera = new Camera(video, {
            onFrame: async () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                await pose.send({ image: video });
            },
            width: 640,
            height: 480
        });
        camera.start();
    } catch (err) {
        console.error("Back camera not found, trying default:", err);
        // Fallback to default if 'exact' fails (e.g., on a laptop)
        const fallbackStream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = fallbackStream;
    }
    
    camera.start();

    pose.onResults((results) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCalibration(ctx);

        if (results.poseLandmarks) {
            const landmarks = results.poseLandmarks;
            // Get midpoint of ankles
            const midX = ((landmarks[27].x + landmarks[28].x) / 2) * canvas.width;
            const midY = ((landmarks[27].y + landmarks[28].y) / 2) * canvas.height;

            // HYPOTHETICAL IDENTITY LOGIC
            // Calculate distance to both "Ghost" player positions
            const distP1 = Math.hypot(midX - p1.x, midY - p1.y);
            const distP2 = Math.hypot(midX - p2.x, midY - p2.y);

            // Assign the detection to the closest player
            let activePlayer = distP1 < distP2 ? p1 : p2;
            
            // Update that player's "last known" position
            activePlayer.x = midX;
            activePlayer.y = midY;
            activePlayer.lastActive = Date.now();

            // Visual feedback: Draw both players
            // Draw current detection
            ctx.fillStyle = activePlayer.color;
            ctx.shadowBlur = 15;
            ctx.shadowColor = activePlayer.color;
            ctx.beginPath(); ctx.arc(midX, midY, 12, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;

            // Draw a ghost of the OTHER player so you see where the system thinks they are
            let otherPlayer = activePlayer === p1 ? p2 : p1;
            ctx.strokeStyle = otherPlayer.color;
            ctx.setLineDash([5, 5]);
            ctx.beginPath(); ctx.arc(otherPlayer.x, otherPlayer.y, 10, 0, Math.PI*2); ctx.stroke();
            ctx.setLineDash([]);

            // STORE DATA FOR ANIMATION PRODUCT
            if (isRecording && homographyMatrix) {
                const courtPos = mapToCourt(midX, midY);
                rallyData.push({
                    player: activePlayer.label,
                    x: courtPos.x,
                    y: courtPos.y,
                    color: activePlayer.color,
                    time: Date.now()
                });
                
                // Live dot on the small court
                drawLiveAnimation(courtPos.x, courtPos.y, activePlayer.color);
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

function stopRecording() {
    isRecording = false;
    renderFinalProduct();
}

function renderFinalProduct() {
    const canvas = document.getElementById("courtCanvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, courtWidth, courtHeight);
    
    // Process and smooth data
    rallyData.forEach((point, i) => {
        setTimeout(() => {
            ctx.fillStyle = point.color;
            ctx.globalAlpha = 0.2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }, i * 5); // Rapid playback
    });
}

// --- MATH UTILS ---
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
    cCtx.fillStyle = "rgba(0,0,0,0.01)";
    cCtx.fillRect(0, 0, courtWidth, courtHeight);
    cCtx.fillStyle = color;
    cCtx.beginPath(); cCtx.arc(x, y, 3, 0, Math.PI * 2); cCtx.fill();
}

function drawCalibration(ctx) {
    for (let i = 0; i < srcPoints.length / 2; i++) {
        ctx.fillStyle = "gold";
        ctx.beginPath(); ctx.arc(srcPoints[i*2], srcPoints[i*2+1], 5, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = "white";
        ctx.fillText(cornerLabels[i], srcPoints[i*2]+10, srcPoints[i*2+1]);
    }
}

function startCapture() { 
    rallyData = [];
    isRecording = true; 
    showScreen("edit"); 
}