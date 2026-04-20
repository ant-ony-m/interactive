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


const SMOOTHING_FACTOR = 0.2; 
const courtWidth = 210, courtHeight = 320;
const courtImg = new Image();
courtImg.src = "assets/squashcourt.svg";

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
        if (detector && video.readyState >= 2) {
            const poses = await detector.estimatePoses(video);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            drawCalibrationMarkers(ctx);

            if (poses.length > 0) {
                poses.slice(0, 2).forEach((pose, i) => {
                    // 1. INTELLIGENT GROUNDING: Get the best possible base point
                    const leftAnkle = pose.keypoints[15];
                    const rightAnkle = pose.keypoints[16];
                    const leftHip = pose.keypoints[11];
                    const rightHip = pose.keypoints[12];

                    let targetX, targetY;

                    // If both ankles are visible, use the midpoint between them
                    if (leftAnkle.score > 0.3 && rightAnkle.score > 0.3) {
                        targetX = (leftAnkle.x + rightAnkle.x) / 2;
                        targetY = (leftAnkle.y + rightAnkle.y) / 2;
                    } 
                    // Fallback: If only one ankle is visible, use that
                    else if (leftAnkle.score > 0.3) {
                        targetX = leftAnkle.x; targetY = leftAnkle.y;
                    } else if (rightAnkle.score > 0.3) {
                        targetX = rightAnkle.x; targetY = rightAnkle.y;
                    }
                    // Deep Fallback: Use the midpoint of the hips if ankles are blocked
                    else if (leftHip.score > 0.3 && rightHip.score > 0.3) {
                        targetX = (leftHip.x + rightHip.x) / 2;
                        targetY = (leftHip.y + rightHip.y) / 2 + 50; // Offset downward
                    }

                    if (targetX && targetY) {
                        // 2. PHYSICS SMOOTHING (LERP)
                        if (!smoothedPos[i]) {
                            smoothedPos[i] = { x: targetX, y: targetY };
                        } else {
                            smoothedPos[i].x += (targetX - smoothedPos[i].x) * SMOOTHING_FACTOR;
                            smoothedPos[i].y += (targetY - smoothedPos[i].y) * SMOOTHING_FACTOR;
                        }

                        const color = i === 0 ? "#00ffff" : "#ff00ff";
                        
                        // Draw smoothed feedback on camera feed
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
                document.getElementById("instruction").style.color = "#ffffff"; // Keep white
            } else {
                calculateHomography();
                document.getElementById("startTrackBtn").disabled = false;
                document.getElementById("instruction").innerText = "CALIBRATION COMPLETE!";
                document.getElementById("instruction").style.color = "#00ff00"; // Flash Green when done!
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
    if (!homographyMatrix) return { x: 0, y: 0 };

    // Create a matrix for the single input point (1 point, 2 channels for x,y)
    const srcPt = cv.matFromArray(1, 1, cv.CV_32FC2, [vx, vy]);
    const dstPt = new cv.Mat();

    // Project the point using the homography matrix
    cv.perspectiveTransform(srcPt, dstPt, homographyMatrix);

    const result = { 
        x: dstPt.data32F[0], 
        y: dstPt.data32F[1] 
    };

    srcPt.delete(); 
    dstPt.delete();
    return result;
}

function recordData(label, pos, color) {
    if (!isRecording) return;
    
    const timeOffset = Date.now() - startTime;
    rallyData.push({ 
        x: pos.x, 
        y: pos.y, 
        color: color, 
        time: timeOffset, 
        player: label 
    });

    const cCanvas = document.getElementById("courtCanvas");
    const cCtx = cCanvas.getContext("2d");

    // Only draw the NEW point instead of clearing everything
    cCtx.fillStyle = color;
    cCtx.beginPath();
    cCtx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
    cCtx.fill();
}

function resetCalibration() {
    srcPoints = [];
    homographyMatrix = null;
    document.getElementById("startTrackBtn").disabled = true;
    document.getElementById("instruction").innerText = "Tap 4 corners: Front-L, Front-R, Back-R, Back-L";
}

function startCapture() { 
    rallyData = []; 
    startTime = Date.now(); // Initialize the clock
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

function showPastRallies() {
    showScreen("history");
    const listContainer = document.getElementById("rallyList");
    const savedRallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");

    listContainer.innerHTML = "";

    savedRallies.forEach((rally, index) => {
        const wrapper = document.createElement("div");
        wrapper.className = "rally-wrapper"; // Add CSS for flex-row
        wrapper.style = "display: flex; gap: 10px; align-items: center;";

        const item = document.createElement("button");
        item.style.flex = "1";
        item.innerHTML = `<span>${rally.name}</span> <small>${rally.date}</small>`;
        item.onclick = () => playbackRally(rally);

        const delBtn = document.createElement("button");
        delBtn.innerHTML = "X";
        delBtn.style = "border-color: rgb(255, 0, 0); color: rgb(255, 0, 0); padding: 10px;";
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteRally(index);
        };

        wrapper.appendChild(item);
        wrapper.appendChild(delBtn);
        listContainer.appendChild(wrapper);
    });
}

function deleteRally(index) {
    if (confirm("Delete this rally permanently?")) {
        let pastRallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
        pastRallies.splice(index, 1);
        localStorage.setItem("ghost_rallies", JSON.stringify(pastRallies));
        showPastRallies(); // Refresh the list
    }
}

function drawCalibrationMarkers(ctx) {
    const labels = ["Front Left", "Front Right", "Back Right", "Back Left"];
    if (srcPoints.length === 0) return;

    ctx.strokeStyle = "rgb(255, 0, 0)";
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
        ctx.fillStyle = "rgba(255, 0, 0, 0.2)"; 
        ctx.fill();
    }
    ctx.stroke();
    ctx.setLineDash([]); 

    for (let i = 0; i < srcPoints.length / 2; i++) {
        const x = srcPoints[i * 2];
        const y = srcPoints[i * 2 + 1];

        ctx.fillStyle = "rgb(255, 0, 0)";
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

// Add this helper to ensure the court is always available
function drawSquashCourt(ctx) {
    const w = 210, h = 320;
    // Use the color picker value if in edit mode, otherwise default yellow
    const color = isEditing ? document.getElementById("courtColor").value : "rgb(255, 230, 0)";
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, w, h); // Boundary

    const shortLineY = h * 0.55; 
    ctx.beginPath(); ctx.moveTo(0, shortLineY); ctx.lineTo(w, shortLineY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, shortLineY); ctx.lineTo(w / 2, h); ctx.stroke();
    
    const boxSize = w / 4; 
    ctx.strokeRect(0, shortLineY, boxSize, boxSize);
    ctx.strokeRect(w - boxSize, shortLineY, boxSize, boxSize);
}

function playbackRally(savedRally) {
    showScreen("edit");
    isEditing = true;
    isRecording = false;
    activeRallyId = savedRally.id;

    // 1. Force Sync: Ensure global rallyData is exactly what was saved
    rallyData = JSON.parse(JSON.stringify(savedRally.data)); 

    // 2. Setup UI
    document.getElementById("editorControls").style.display = "block";
    document.getElementById("stopBtn").style.display = "none";
    document.getElementById("backBtn").style.display = "inline-block";
    document.getElementById("liveHeader").innerText = "Analysis: " + savedRally.name;

    // 3. Reset Timeline
    const timeline = document.getElementById("timeline");
    if (rallyData.length > 0) {
        const lastPoint = rallyData[rallyData.length - 1];
        timeline.max = lastPoint.time;
        timeline.value = 0;
        currentTime = 0; // Reset playhead to start
    }

    // 4. Update Color Pickers to saved values
    document.getElementById("p1Color").value = savedRally.p1Color || "#00ffff";
    document.getElementById("p2Color").value = savedRally.p2Color || "#ff00ff";
    
    // 5. Trigger the first frame
    drawFrame(0);
}

function manualSeek(val) {
    currentTime = parseInt(val);
    drawFrame(currentTime);
}

function togglePlayback() {
    const playBtn = document.querySelector("#editorControls button");
    const timeline = document.getElementById("timeline");
    
    isPaused = !isPaused;
    playBtn.innerText = isPaused ? "Play" : "Pause";

    if (!isPaused) {
        // If the user clicks play at the very end, reset to start
        if (currentTime >= timeline.max) {
            currentTime = 0;
            timeline.value = 0;
        }

        playbackInterval = setInterval(() => {
            currentTime += 50; 
            timeline.value = currentTime;
            drawFrame(currentTime);

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

function saveRallyChanges() {
    let pastRallies = JSON.parse(localStorage.getItem("ghost_rallies") || "[]");
    const index = pastRallies.findIndex(r => r.id === activeRallyId);

    if (index !== -1) {
        // 1. Get values from the UI
        const p1Col = document.getElementById("p1Color").value;
        const p2Col = document.getElementById("p2Color").value;
        const courtCol = document.getElementById("courtColor").value;
        const bgCol = document.getElementById("bgColor").value;

        // 2. Update the saved object
        pastRallies[index].p1Color = p1Col;
        pastRallies[index].p2Color = p2Col;
        pastRallies[index].courtColor = courtCol;
        pastRallies[index].bgColor = bgCol;

        // 3. Apply background immediately
        document.body.style.background = bgCol;

        // 4. Update the actual data points so the colors change in the file
        pastRallies[index].data.forEach(p => {
            p.color = (p.player === "P1") ? p1Col : p2Col;
        });

        localStorage.setItem("ghost_rallies", JSON.stringify(pastRallies));
        rallyData = pastRallies[index].data; // Sync current session
        
        alert("Rally Archive Updated!");
        drawFrame(currentTime); 
    }
}

function drawFrame(targetTime) {
    const canvas = document.getElementById("courtCanvas");
    const ctx = canvas.getContext("2d");
    
    // 1. Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 2. Redraw the court lines so they don't disappear
    drawSquashCourt(ctx);

    const p1Col = document.getElementById("p1Color").value;
    const p2Col = document.getElementById("p2Color").value;

    // 3. Filter and Draw
    rallyData.forEach(point => {
        if (point.time <= targetTime) {
            // DEBUG: If you see this in the console, the data is there but drawing is failing
            // console.log("Drawing point at:", point.x, point.y); 

            ctx.fillStyle = (point.player === "P1") ? p1Col : p2Col;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    });
}