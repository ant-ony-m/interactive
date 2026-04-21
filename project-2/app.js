let detector;
let srcPoints = [];
let homographyMatrix = null;
let isRecording = false;
let rallyData = []; 
let smoothedPos = [null, null]; 
let ptMat, outMat;
let playbackInterval;
let isPaused = true;
let startTime = 0;
let currentTime = 0;
let isEditing = false;
let activeRallyId = null;
let currentStep = 0;

const SMOOTHING_FACTOR = 0.2; 
const courtWidth = 210, courtHeight = 320;

// --- NAVIGATION & SCREENS ---
function showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
}

function goHome() { location.reload(); }

function goToCamera() {
    showScreen("camera");
    lockLandscape(); // Attempt to lock
    initTensorFlow().then(() => startCamera());
}

// --- RESTORED SCROLL LOGIC ---
function initScrollAnimations() {
    const ball = document.querySelector(".ball");
    const cta = document.querySelector(".cta");
    const arrow = document.getElementById("scrollArrow");

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

// --- DETECTION ENGINE ---
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

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        video.srcObject = stream;
    } catch(e) {
        const fallback = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = fallback;
    }

    async function detect() {
        if (detector && video.readyState >= 2) {
            const poses = await detector.estimatePoses(video);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawCalibrationMarkers(ctx);

            if (isRecording) { recordData(null, null, null); }

            if (poses.length > 0) {
                poses.slice(0, 2).forEach((pose, i) => {
                    const lAnkle = pose.keypoints[15], rAnkle = pose.keypoints[16];
                    const lHip = pose.keypoints[11], rHip = pose.keypoints[12];
                    let tx, ty;

                    if (lAnkle.score > 0.3 && rAnkle.score > 0.3) {
                        tx = (lAnkle.x + rAnkle.x) / 2; ty = (lAnkle.y + rAnkle.y) / 2;
                    } else if (lAnkle.score > 0.3) {
                        tx = lAnkle.x; ty = lAnkle.y;
                    } else if (lHip.score > 0.3) {
                        tx = lHip.x; ty = lHip.y + 50;
                    }

                    if (tx && ty) {
                        if (!smoothedPos[i]) smoothedPos[i] = { x: tx, y: ty };
                        else {
                            smoothedPos[i].x += (tx - smoothedPos[i].x) * SMOOTHING_FACTOR;
                            smoothedPos[i].y += (ty - smoothedPos[i].y) * SMOOTHING_FACTOR;
                        }

                        const color = (i === 0) ? (document.getElementById("p1Color")?.value || "#00ffff") : (document.getElementById("p2Color")?.value || "#ff00ff");
                        ctx.fillStyle = color;
                        ctx.shadowBlur = 10; ctx.shadowColor = color;
                        ctx.beginPath(); ctx.arc(smoothedPos[i].x, smoothedPos[i].y, 8, 0, Math.PI*2); ctx.fill();
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

    video.onloadedmetadata = () => { canvas.width = video.videoWidth; canvas.height = video.videoHeight; detect(); };

    canvas.onclick = (e) => {
        const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
        if (srcPoints.length < 8) {
            const rect = canvas.getBoundingClientRect();
            
            // Calculate the ratio between actual canvas pixels and displayed size
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            // Get the touch/click relative to the top-left of the canvas
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;

            srcPoints.push(x, y);
            
            const nextIdx = srcPoints.length / 2;
            if (nextIdx < 4) { 
                document.getElementById("instruction").innerText = `Tap: ${labels[nextIdx]}`; 
            } else {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
                document.getElementById("instruction").innerText = "CALIBRATION COMPLETE!";
                document.getElementById("instruction").style.color = "#00ff00";
            }
        }
    };
}

// --- MATH & PERSPECTIVE ---
function calculateHomography() {
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints);
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, courtWidth, 0, courtWidth, courtHeight, 0, courtHeight]);
    homographyMatrix = cv.findHomography(srcMat, dstMat);
    srcMat.delete(); dstMat.delete();
}

function mapToCourt(vx, vy) {
    if (!ptMat) ptMat = new cv.Mat(3, 1, cv.CV_64FC1);
    if (!outMat) outMat = new cv.Mat();
    ptMat.data64F[0] = vx; ptMat.data64F[1] = vy; ptMat.data64F[2] = 1;
    cv.gemm(homographyMatrix, ptMat, 1, new cv.Mat(), 0, outMat);
    return { x: outMat.data64F[0] / outMat.data64F[2], y: outMat.data64F[1] / outMat.data64F[2] };
}

// --- RECORDING & RENDERING ---
function recordData(label, pos, color) {
    const cCanvas = document.getElementById("courtCanvas");
    if (!cCanvas) return;
    const cCtx = cCanvas.getContext("2d");
    const bgCol = document.getElementById("bgColor")?.value || "#ffffff";
    
    cCtx.globalAlpha = 0.1;
    cCtx.fillStyle = bgCol;
    cCtx.fillRect(0, 0, cCanvas.width, cCanvas.height);
    cCtx.globalAlpha = 1.0;
    drawSquashCourt(cCtx);

    if (isRecording && label && pos) {
        rallyData.push({ x: pos.x, y: pos.y, color: color, time: Date.now() - startTime, player: label });
        cCtx.fillStyle = color;
        cCtx.beginPath(); cCtx.arc(pos.x, pos.y, 6, 0, Math.PI * 2); cCtx.fill();
    }
}

function drawSquashCourt(ctx) {
    const color = document.getElementById("courtColor")?.value || "rgb(255, 0, 0)";
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 210, 320);
    ctx.beginPath(); ctx.moveTo(0, 176); ctx.lineTo(210, 176); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(105, 176); ctx.lineTo(105, 320); ctx.stroke();
    ctx.strokeRect(0, 176, 52.5, 52.5); ctx.strokeRect(157.5, 176, 52.5, 52.5);
}

// --- RALLY MANAGEMENT ---
function startCapture() { 
    rallyData = []; 
    startTime = Date.now(); 
    isRecording = true; 
    isEditing = false;
    
    const header = document.getElementById("editorHeader");
    if (header) header.innerText = "Live Movement";

    showScreen("edit"); 
    
    document.getElementById("editorControls").style.display = "none";
    document.getElementById("stopBtn").style.display = "block";
}

function stopRecording() { 
    isRecording = false; 
    const name = prompt("Name this rally:", `Rally ${new Date().toLocaleTimeString()}`);
    if (name) {
        const rally = {
            id: Date.now(), name, date: new Date().toLocaleDateString(), data: rallyData,
            settings: { 
                p1Color: document.getElementById("p1Color").value, 
                p2Color: document.getElementById("p2Color").value,
                courtColor: document.getElementById("courtColor").value,
                bgColor: document.getElementById("bgColor").value,
                trail: document.getElementById("trailToggle").checked
            }
        };
        const list = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
        list.push(rally);
        localStorage.setItem("ghost_rallies", JSON.stringify(list));
    }
    goHome();
}

function showPastRallies() {
    showScreen("history");
    const container = document.getElementById("rallyList");
    const rallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
    container.innerHTML = "";

    rallies.forEach((r, i) => {
        const div = document.createElement("div");
        div.style = "display: flex; gap: 10px; margin-bottom: 10px;";
        
        // Create the play button
        const playBtn = document.createElement("button");
        playBtn.style.flex = "1";
        playBtn.innerText = r.name;
        playBtn.onclick = () => playbackRallyByIndex(i); // Use index helper

        // Create the delete button
        const delBtn = document.createElement("button");
        delBtn.style.color = "red";
        delBtn.innerText = "X";
        delBtn.onclick = () => deleteRally(i);

        div.appendChild(playBtn);
        div.appendChild(delBtn);
        container.appendChild(div);
    });
}

// Helper to prevent JSON stringify issues in HTML attributes
function playbackRallyByIndex(index) {
    const rallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
    playbackRally(rallies[index]);
}

function playbackRally(savedRally) {
    showScreen("edit");
    isEditing = true;
    isRecording = false;
    activeRallyId = savedRally.id;
    
    // Safety check for data
    rallyData = savedRally.data || []; 

    // Update Header
    const header = document.getElementById("editorHeader");
    if (header) header.innerText = savedRally.name;

    // Show/Hide appropriate UI
    document.getElementById("editorControls").style.display = "block";
    document.getElementById("stopBtn").style.display = "none";

    // Restore Settings
    const s = savedRally.settings || { p1Color: "#00ffff", p2Color: "#ff00ff", courtColor: "#ff0000", bgColor: "#ffffff", trail: true };
    document.getElementById("p1Color").value = s.p1Color;
    document.getElementById("p2Color").value = s.p2Color;
    document.getElementById("courtColor").value = s.courtColor;
    document.getElementById("bgColor").value = s.bgColor;
    document.getElementById("trailToggle").checked = s.trail;

    // Timeline Setup
    const timeline = document.getElementById("timeline");
    if (rallyData.length > 0) {
        const lastTimestamp = rallyData[rallyData.length - 1].time;
        timeline.max = lastTimestamp;
        timeline.value = 0;
        currentTime = 0;
    } else {
        timeline.max = 0;
    }

    // DRAW IMMEDIATELY so the court isn't blank
    drawFrame(0);
}

function playbackRally(savedRally) {
    showScreen("edit");
    isEditing = true;
    isRecording = false;
    activeRallyId = savedRally.id;
    
    rallyData = JSON.parse(JSON.stringify(savedRally.data)); 

    // Header now matches HTML ID
    const header = document.getElementById("editorHeader");
    if (header) header.innerText = savedRally.name;

    // Toggle Buttons
    document.getElementById("editorControls").style.display = "block";
    const backBtn = document.getElementById("editorBackButton");
    if (backBtn) backBtn.style.display = "block";
    document.getElementById("stopBtn").style.display = "none";

    // Restore Settings
    const s = savedRally.settings || { p1Color: "#00ffff", p2Color: "#ff00ff", courtColor: "#ff0000", bgColor: "#ffffff", trail: true };
    document.getElementById("p1Color").value = s.p1Color;
    document.getElementById("p2Color").value = s.p2Color;
    document.getElementById("courtColor").value = s.courtColor;
    document.getElementById("bgColor").value = s.bgColor;
    document.getElementById("trailToggle").checked = s.trail;

    // Timeline Setup
    const timeline = document.getElementById("timeline");
    if (rallyData.length > 0) {
        const lastTimestamp = rallyData[rallyData.length - 1].time;
        timeline.max = lastTimestamp;
        timeline.value = 0;
        currentTime = 0;
    }

    // DRAW IMMEDIATELY
    drawFrame(0);
}

function saveRallyChanges() {
    let list = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
    const idx = list.findIndex(r => r.id === activeRallyId);
    if (idx !== -1) {
        list[idx].settings = {
            p1Color: document.getElementById("p1Color").value,
            p2Color: document.getElementById("p2Color").value,
            courtColor: document.getElementById("courtColor").value,
            bgColor: document.getElementById("bgColor").value,
            trail: document.getElementById("trailToggle").checked
        };
        localStorage.setItem("ghost_rallies", JSON.stringify(list));
        alert("Saved!");
    }
}

// --- RESTORED MODAL/ABOUT LOGIC ---
function goToAbout() {
    const modal = document.getElementById("aboutModal");
    const steps = document.querySelectorAll(".step");
    const dotContainer = document.getElementById("dotContainer");
    
    modal.style.display = "flex";

    // 1. Clear existing dots and generate new ones based on step count
    dotContainer.innerHTML = ""; 
    steps.forEach((_, i) => {
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.onclick = () => setStep(i);
        dotContainer.appendChild(dot);
    });

    setStep(0); // Always start at the first step
}

function setStep(n) {
    const steps = document.querySelectorAll(".step");
    const dots = document.querySelectorAll(".dot");

    // 2. Wrap around logic (prevents breaking at the end)
    if (n >= steps.length) n = 0;
    if (n < 0) n = steps.length - 1;
    
    currentStep = n;

    // 3. Update visibility
    steps.forEach((s, i) => s.classList.toggle("active", i === n));
    dots.forEach((d, i) => d.classList.toggle("active", i === n));
}

function moveStep(d) {
    setStep(currentStep + d);
}

function closeAbout() { document.getElementById("aboutModal").style.display = "none"; }


// --- RESTORED VIDEO EXPORT ---
async function exportRallyVideo() {
    const canvas = document.getElementById("courtCanvas");
    const exportBtn = document.getElementById("exportBtn");
    
    // 1. Determine supported format (Prefer MP4)
    let mimeType = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm'; 
    }

    const stream = canvas.captureStream(30); // 30 FPS
    const recorder = new MediaRecorder(stream, { 
        mimeType: mimeType,
        videoBitsPerSecond: 2500000 // High quality 2.5Mbps
    });
    
    const chunks = [];
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Ghost_Rally_${Date.now()}.mp4`;
        a.click();
        
        exportBtn.innerText = "EXPORT VIDEO";
        exportBtn.disabled = false;
    };

    // 2. UI Feedback
    exportBtn.innerText = "RECORDING...";
    exportBtn.disabled = true;
    
    // 3. Start high-speed render loop
    currentTime = 0;
    const totalDuration = rallyData.length > 0 ? rallyData[rallyData.length - 1].time : 0;
    
    recorder.start();

    const exportInterval = setInterval(() => {
        currentTime += 33; // Frame increment for 30fps
        drawFrame(currentTime);
        
        if (currentTime >= totalDuration) {
            clearInterval(exportInterval);
            setTimeout(() => recorder.stop(), 500); // Small buffer to catch the last frame
        }
    }, 33);
}

function drawFrame(targetTime) {
    const canvas = document.getElementById("courtCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    
    // Grab current UI colors
    const bgCol = document.getElementById("bgColor").value;
    const p1Col = document.getElementById("p1Color").value;
    const p2Col = document.getElementById("p2Color").value;
    const showTrail = document.getElementById("trailToggle").checked;
    
    // 1. Always Draw Background
    ctx.fillStyle = bgCol;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Always Draw Court Lines
    drawSquashCourt(ctx);

    // 3. Draw dots if data exists
    if (!rallyData || rallyData.length === 0) return;

    const trailDuration = 1500; 

    rallyData.forEach((point) => {
        const timeDiff = targetTime - point.time;

        if (timeDiff >= 0 && timeDiff <= trailDuration) {
            ctx.fillStyle = (point.player === "P1") ? p1Col : p2Col;

            if (timeDiff < 50) { // Active player position
                ctx.globalAlpha = 1.0; 
                ctx.beginPath();
                ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
                ctx.fill();
            } 
            else if (showTrail) { // Fading trail
                const fadeScale = 1 - (timeDiff / trailDuration);
                ctx.globalAlpha = fadeScale * 0.4; 
                ctx.beginPath();
                ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    });
    ctx.globalAlpha = 1.0; 
}

function deleteRally(i) { if(confirm("Delete?")) { let r = JSON.parse(localStorage.getItem("ghost_rallies")); r.splice(i,1); localStorage.setItem("ghost_rallies", JSON.stringify(r)); showPastRallies(); } }
function manualSeek(v) { currentTime = parseInt(v); drawFrame(currentTime); }
function togglePlayback() {
    const playBtn = document.querySelector("#editorControls button");
    const timeline = document.getElementById("timeline");
    
    isPaused = !isPaused;
    playBtn.innerText = isPaused ? "Play" : "Pause";

    if (!isPaused) {
        // If the slider is at the end, reset to start
        if (currentTime >= parseInt(timeline.max)) {
            currentTime = 0;
        }

        playbackInterval = setInterval(() => {
            currentTime += 50; // Step by 50ms
            
            // Sync the slider position to the current playback time
            timeline.value = currentTime;
            
            drawFrame(currentTime);

            // Stop logic
            if (currentTime >= parseInt(timeline.max)) {
                clearInterval(playbackInterval);
                isPaused = true;
                playBtn.innerText = "Play";
            }
        }, 50);
    } else {
        clearInterval(playbackInterval);
    }
}

function drawCalibrationMarkers(ctx) {
    const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
    if (srcPoints.length === 0) return;

    // 1. Set styles for the connecting lines
    ctx.strokeStyle = "rgb(255, 0, 0)";
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 5]); // The "Dashed" look

    // 2. Trace the shape
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

    // 3. Close the box and fill it if 4 points are set
    if (srcPoints.length === 8) {
        ctx.lineTo(srcPoints[0], srcPoints[1]);
        ctx.fillStyle = "rgba(255, 0, 0, 0.2)"; // Ghostly red fill
        ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]); // Reset dash so dots are solid

    // 4. Draw individual points and labels
    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];

        // The Dot
        ctx.fillStyle = "rgb(255, 0, 0)";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();

        // The Text Label (with shadow for visibility)
        ctx.shadowBlur = 4;
        ctx.shadowColor = "black";
        ctx.fillStyle = "white";
        ctx.font = "12px Lexend"; 
        ctx.fillText(labels[i], x + 15, y - 15);
        ctx.shadowBlur = 0; 
    }
}

function resetCalibration() {
    srcPoints = [];
    homographyMatrix = null;

    // Reset UI button and instruction text
    const startBtn = document.getElementById("startTrackBtn");
    if (startBtn) startBtn.disabled = true;

    const instruction = document.getElementById("instruction");
    if (instruction) {
        instruction.innerText = "Tap: Front Left";
        instruction.style.color = "#ffffff"; 
    }
}

async function lockLandscape() {
    try {
        if (screen.orientation && screen.orientation.lock) {
            await screen.orientation.lock("landscape");
        }
    } catch (e) {
        console.warn("Landscape lock not supported on this browser (common on iOS Safari). Please rotate your phone manually!");
    }
}

// Update your existing goToCamera to include this
