let detector;
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; 
let smoothedPos = [null, null]; 
let ptMat, outMat;

const SMOOTHING_FACTOR = 0.2; 
const courtWidth = 210, courtHeight = 320;

function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goHome() { location.reload(); }

function goToCamera() {
    showScreen("camera");
    initTensorFlow().then(() => startCamera());
}

function initScrollAnimations() {
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");

    window.addEventListener("scroll", () => {
        const scrollVal = window.scrollY;

        if (ball) {
            ball.style.transform = `translateY(${scrollVal * .4}px) rotate(${scrollVal * 1.5}deg)`;
        }

        if (scrollVal > 500) {
            cta.style.opacity = "1";
            cta.style.transform = "translateY(0)";
        } else {
            cta.style.opacity = "0";
            cta.style.transform = "translateY(30px)";
        }
    });
}

initScrollAnimations();

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


async function detect() {
    const video = document.getElementById("cameraFeed");
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");

    if (detector && video.readyState >= 2) {
        const poses = await detector.estimatePoses(video);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawCalibrationMarkers(ctx);

        // Always draw the court/background on the 2D canvas during recording
        if (isRecording) {
            recordData(null, null, null);
        }

        if (poses.length > 0) {
            poses.slice(0, 2).forEach((pose, i) => {
                const leftAnkle = pose.keypoints[15];
                const rightAnkle = pose.keypoints[16];
                const leftHip = pose.keypoints[11];
                const rightHip = pose.keypoints[12];

                let targetX, targetY;

                if (leftAnkle.score > 0.3 && rightAnkle.score > 0.3) {
                    targetX = (leftAnkle.x + rightAnkle.x) / 2;
                    targetY = (leftAnkle.y + rightAnkle.y) / 2;
                } else if (leftAnkle.score > 0.3) {
                    targetX = leftAnkle.x; targetY = leftAnkle.y;
                } else if (rightAnkle.score > 0.3) {
                    targetX = rightAnkle.x; targetY = rightAnkle.y;
                } else if (leftHip.score > 0.3 && rightHip.score > 0.3) {
                    targetX = (leftHip.x + rightHip.x) / 2;
                    targetY = (leftHip.y + rightHip.y) / 2 + 50; 
                }

                if (targetX && targetY) {
                    if (!smoothedPos[i]) {
                        smoothedPos[i] = { x: targetX, y: targetY };
                    } else {
                        smoothedPos[i].x += (targetX - smoothedPos[i].x) * SMOOTHING_FACTOR;
                        smoothedPos[i].y += (targetY - smoothedPos[i].y) * SMOOTHING_FACTOR;
                    }

                    // Pull colors from pickers or use neon defaults
                    let p1Val = document.getElementById("p1Color")?.value || "#00ffff";
                    let p2Val = document.getElementById("p2Color")?.value || "#ff00ff";
                    const color = (i === 0) ? p1Val : p2Val;
                    
                    // Draw on Camera Feed
                    ctx.fillStyle = color;
                    ctx.shadowBlur = 10;
                    ctx.shadowColor = color;
                    ctx.beginPath(); 
                    ctx.arc(smoothedPos[i].x, smoothedPos[i].y, 8, 0, Math.PI*2); 
                    ctx.fill();
                    ctx.shadowBlur = 0;

                    if (isRecording && homographyMatrix) {
                        const courtPos = mapToCourt(smoothedPos[i].x, smoothedPos[i].y);
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

    canvas.onclick = (e) => {
        const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
        
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

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

function calculateHomography() {
    if (typeof cv === 'undefined') return;
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcMat, dstMat);
    srcMat.delete(); dstMat.delete();
}

function mapToCourt(vx, vy) {
    if (!ptMat) ptMat = new cv.Mat(3, 1, cv.CV_64FC1);
    if (!outMat) outMat = new cv.Mat();

    // Fill the pre-allocated matrix
    ptMat.data64F[0] = vx;
    ptMat.data64F[1] = vy;
    ptMat.data64F[2] = 1;

    cv.gemm(homographyMatrix, ptMat, 1, new cv.Mat(), 0, outMat);
    
    return { 
        x: outMat.data64F[0] / outMat.data64F[2], 
        y: outMat.data64F[1] / outMat.data64F[2] 
    };
}

function recordData(label, pos, color) {
    rallyData.push({ x: pos.x, y: pos.y, color: color });
    
    const cCanvas = document.getElementById("courtCanvas");
    const cCtx = cCanvas.getContext("2d");

    // Create a fade effect (Semi-transparent rectangle over the whole canvas)
    // This makes old dots slowly disappear, creating a "comet trail"
    cCtx.fillStyle = "rgba(0, 0, 0, 0.05)"; 
    cCtx.fillRect(0, 0, cCanvas.width, cCanvas.height);

    cCtx.fillStyle = color;
    cCtx.beginPath(); 
    cCtx.arc(pos.x, pos.y, 4, 0, Math.PI*2); 
    cCtx.fill();
}

function resetCalibration() {
    srcPoints = [];
    homographyMatrix = null;
    document.getElementById("startTrackBtn").disabled = true;
    document.getElementById("instruction").innerText = "Tap: Front Left Corner;
}

function startCapture() { 
    rallyData = []; 
    isRecording = true; 
    showScreen("edit"); 
}

function stopRecording() { 
    isRecording = false; 
    
    const rallyName = prompt("Enter a name for this rally:", `Rally ${new Date().toLocaleTimeString()}`);
    
    if (rallyName) {
        const rallyToSave = {
            id: Date.now(),
            name: rallyName,
            date: new Date().toLocaleDateString(),
            data: rallyData // This is your array of {x, y, color}
        };

        // Get existing rallies from storage or start a new list
        const pastRallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
        pastRallies.push(rallyToSave);
        
        // Save back to browser memory
        localStorage.setItem("ghost_rallies", JSON.stringify(pastRallies));
        
        alert("Rally saved to Ghost archives.");
    }
    goHome();
}

function drawCalibrationMarkers(ctx) {
    const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
    if (srcPoints.length === 0) return;

    ctx.strokeStyle = "rgb(255, 230, 0)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 5]);

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

    if (srcPoints.length === 8) {
        ctx.lineTo(srcPoints[0], srcPoints[1]);
        ctx.fillStyle = "rgba(255, 230, 0, 0.2)"; 
        ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]); 

    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];

        ctx.fillStyle = "rgb(255, 230, 0)";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillStyle = "white";
        ctx.font = "12px Lexend"; 
        ctx.fillText(labels[i], x + 15, y - 15);
        ctx.shadowBlur = 0; 
    }
}