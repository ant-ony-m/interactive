let detector;
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; 

const courtWidth = 210, courtHeight = 320;

// --- NAVIGATION ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goHome() { location.reload(); }

function goToCamera() {
    showScreen("camera");
    initTensorFlow().then(() => startCamera());
}

// Scroll listener for landing page
// --- SMOOTH SCROLL ANIMATION ---
function initScrollAnimations() {
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");

    window.addEventListener("scroll", () => {
        const scrollVal = window.scrollY;

        // 1. Moving the ball: 
        // It drops as you scroll (scrollVal * 0.8) and rotates
        if (ball) {
            ball.style.transform = `translateY(${scrollVal * .4}px) rotate(${scrollVal * 1.5}deg)`;
        }

        // 2. Fading in the Call to Action buttons
        // Triggered once you've scrolled past the hero section (~500px)
        if (scrollVal > 500) {
            cta.style.opacity = "1";
            cta.style.transform = "translateY(0)";
        } else {
            cta.style.opacity = "0";
            cta.style.transform = "translateY(30px)";
        }
    });
}

// Call this function at the very bottom of your script
initScrollAnimations();

// --- TRACKING ENGINE ---
async function initTensorFlow() {
    const model = poseDetection.SupportedModels.MoveNet;
    detector = await poseDetection.createDetector(model, {
        modelType: poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        enableTracking: true
    });
}

async function startCamera() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    // Camera Fallback Logic
    const constraints = { video: { facingMode: "environment" } };
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
    } catch(e) {
        const fallback = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = fallback;
    }

    // Detection Loop
    async function detect() {
        if (detector && video.readyState >= 2) {
            const poses = await detector.estimatePoses(video);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawCalibrationMarkers(ctx);

            if (poses.length > 0) {
                poses.slice(0, 2).forEach((pose, i) => {
                    // Use ankles for ground-contact tracking
                    const leftAnkle = pose.keypoints[15];
                    const rightAnkle = pose.keypoints[16];

                    if (leftAnkle.score > 0.3) {
                        const x = leftAnkle.x;
                        const y = leftAnkle.y;
                        const color = i === 0 ? "#00ffff" : "#ff00ff";

                        // Draw feedback on camera
                        ctx.fillStyle = color;
                        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2); ctx.fill();

                        if (isRecording && homographyMatrix) {
                            const courtPos = mapToCourt(x, y);
                            recordData(`P${i+1}`, courtPos, color);
                        }
                    }
                });
            }
        }
        requestAnimationFrame(detect);
    }

    video.onloadedmetadata = () => {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        detect();
    };

    // Calibration Taps
    canvas.onclick = (e) => {
        const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
        
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            
            // Calculate the ratio between the actual canvas size and its size on screen
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            // Get the actual click position relative to the canvas internal resolution
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            srcPoints.push(x, y);

            const nextIndex = srcPoints.length / 2;
            if (nextIndex < 4) {
                document.getElementById("instruction").innerText = `Tap: ${labels[nextIndex]}`;
            } else {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
                document.getElementById("instruction").innerText = "Calibration Complete!";
            }
        }
    };
}

// --- MATH & UTILS ---
function calculateHomography() {
    if (typeof cv === 'undefined') return;
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcMat, dstMat);
    srcMat.delete(); dstMat.delete();
}

function mapToCourt(vx, vy) {
    const pt = cv.matFromArray(3, 1, cv.CV_64FC1, [vx, vy, 1]);
    const out = new cv.Mat();
    cv.gemm(homographyMatrix, pt, 1, new cv.Mat(), 0, out);
    const result = { 
        x: out.data64F[0] / out.data64F[2], 
        y: out.data64F[1] / out.data64F[2] 
    };
    pt.delete(); out.delete();
    return result;
}

function recordData(label, pos, color) {
    rallyData.push({ x: pos.x, y: pos.y, color: color });
    const cCtx = document.getElementById("courtCanvas").getContext("2d");
    cCtx.fillStyle = color;
    cCtx.beginPath(); cCtx.arc(pos.x, pos.y, 3, 0, Math.PI*2); cCtx.fill();
}

function resetCalibration() {
    srcPoints = [];
    homographyMatrix = null;
    document.getElementById("startTrackBtn").disabled = true;
    document.getElementById("instruction").innerText = "Tap 4 corners: Front-L, Front-R, Back-R, Back-L";
}

function startCapture() { 
    rallyData = []; 
    isRecording = true; 
    showScreen("edit"); 
}

function stopRecording() { 
    isRecording = false; 
    alert("Rally saved. Rendering heatmap...");
}

function drawCalibrationMarkers(ctx) {
    const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
    if (srcPoints.length === 0) return;

    ctx.strokeStyle = "rgb(255, 230, 0)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 5]);

    // Draw the connecting lines
    ctx.beginPath();
    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }

    // If we have all 4 points, close the rectangle back to point 1
    if (srcPoints.length === 8) {
        ctx.lineTo(srcPoints[0], srcPoints[1]);
        ctx.fillStyle = "rgba(255, 230, 0, 0.2)"; // Light fill for the court area
        ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset line style

    // Draw the individual dots and text labels
    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];

        // Draw Dot
        ctx.fillStyle = "rgb(255, 230, 0)";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // Draw Label Shadow (for readability)
        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillStyle = "white";
        ctx.font = "12px Lexend"; // Increased size for mobile
        ctx.fillText(labels[i], x + 15, y - 15);
        ctx.shadowBlur = 0; // Reset shadow
    }
}
