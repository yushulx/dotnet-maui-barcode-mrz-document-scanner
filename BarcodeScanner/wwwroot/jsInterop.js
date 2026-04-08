let cvr = null;
let cameraEnhancer = null;
let cameraView = null;
let parser = null;
let isSDKReady = false;
let cameras = null;
let resolution = null;
let isDetecting = false;
let isCaptured = false;
let globalPoints = null;
let dotnetHelper = null;
let currentMode = 'barcode';

// ── Overlay helpers for file-mode image ──────────────────────────────────────
function syncOverlayToImage(canvasId, imgId) {
    let canvas = document.getElementById(canvasId);
    let img = document.getElementById(imgId);
    if (!canvas || !img || !img.naturalWidth) return false;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.style.width = img.offsetWidth + 'px';
    canvas.style.height = img.offsetHeight + 'px';
    return true;
}

function drawFileOverlay(canvasId, imgId, locationsList, strokeColor, fillColor) {
    if (!syncOverlayToImage(canvasId, imgId)) return;
    let canvas = document.getElementById(canvasId);
    let ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = strokeColor;
    ctx.fillStyle = fillColor;
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 250));
    for (let points of locationsList) {
        if (!points || points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

// ── Perspective-correction helpers (homography inverse-mapping) ──────────────
function gaussJordan(A, b) {
    const n = 8;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
        let maxRow = col;
        for (let row = col + 1; row < n; row++)
            if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
        [M[col], M[maxRow]] = [M[maxRow], M[col]];
        if (Math.abs(M[col][col]) < 1e-12) throw new Error('Singular matrix');
        const piv = M[col][col];
        for (let j = col; j <= n; j++) M[col][j] /= piv;
        for (let row = 0; row < n; row++) {
            if (row === col) continue;
            const f = M[row][col];
            for (let j = col; j <= n; j++) M[row][j] -= f * M[col][j];
        }
    }
    return M.map(r => r[n]);
}

function buildHomography(srcPts, dstPts) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
        const { x: sx, y: sy } = srcPts[i], { x: dx, y: dy } = dstPts[i];
        A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]); b.push(dx);
        A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]); b.push(dy);
    }
    const h = gaussJordan(A, b);
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

function applyH(H, x, y) {
    const w = H[2][0] * x + H[2][1] * y + H[2][2];
    return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w,
            (H[1][0] * x + H[1][1] * y + H[1][2]) / w];
}

// warpPerspective: src canvas + 4 quad points (TL,TR,BR,BL) → corrected canvas
function warpPerspective(srcCanvas, quadPts) {
    const MAX_DIM = 2400;
    let sw = srcCanvas.width, sh = srcCanvas.height;
    let scale = 1;
    if (Math.max(sw, sh) > MAX_DIM) scale = MAX_DIM / Math.max(sw, sh);

    const workW = Math.round(sw * scale), workH = Math.round(sh * scale);
    const workCanvas = document.createElement('canvas');
    workCanvas.width = workW; workCanvas.height = workH;
    workCanvas.getContext('2d').drawImage(srcCanvas, 0, 0, workW, workH);

    const sp = quadPts.map(p => ({ x: p.x * scale, y: p.y * scale }));
    const [tl, tr, br, bl] = sp;
    const W = Math.round(Math.max(Math.hypot(tr.x-tl.x, tr.y-tl.y),
                                  Math.hypot(br.x-bl.x, br.y-bl.y)));
    const H = Math.round(Math.max(Math.hypot(bl.x-tl.x, bl.y-tl.y),
                                  Math.hypot(br.x-tr.x, br.y-tr.y)));
    if (W < 1 || H < 1) return null;

    // Inverse mapping: dst pixel → src pixel
    const dstPts = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];
    const Hinv = buildHomography(dstPts, sp);

    const srcCtx = workCanvas.getContext('2d');
    const srcD = srcCtx.getImageData(0, 0, workW, workH).data;
    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = W; dstCanvas.height = H;
    const dstCtx = dstCanvas.getContext('2d');
    const dstImg = dstCtx.createImageData(W, H);
    const dst = dstImg.data;

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const [sx, sy] = applyH(Hinv, x + 0.5, y + 0.5);
            if (sx < 0 || sx >= workW - 1 || sy < 0 || sy >= workH - 1) continue;
            const x0 = sx | 0, y0 = sy | 0;
            const x1 = x0 + 1, y1 = y0 + 1;
            const fx = sx - x0, fy = sy - y0;
            const i00=(y0*workW+x0)*4, i10=(y0*workW+x1)*4,
                  i01=(y1*workW+x0)*4, i11=(y1*workW+x1)*4;
            const di = (y * W + x) * 4;
            const w00=(1-fx)*(1-fy), w10=fx*(1-fy), w01=(1-fx)*fy, w11=fx*fy;
            dst[di]   = (srcD[i00]*w00 + srcD[i10]*w10 + srcD[i01]*w01 + srcD[i11]*w11) | 0;
            dst[di+1] = (srcD[i00+1]*w00 + srcD[i10+1]*w10 + srcD[i01+1]*w01 + srcD[i11+1]*w11) | 0;
            dst[di+2] = (srcD[i00+2]*w00 + srcD[i10+2]*w10 + srcD[i01+2]*w01 + srcD[i11+2]*w11) | 0;
            dst[di+3] = 255;
        }
    }
    dstCtx.putImageData(dstImg, 0, 0);
    return dstCanvas;
}
const quadEditor = {
    canvas: null,
    img: null,
    points: [],
    dragIndex: -1,
    scaleX: 1,
    scaleY: 1,
    _listeners: null,

    init(canvasId, imgId, pointsJson) {
        if (this.canvas && this._listeners) {
            this.canvas.removeEventListener('pointerdown', this._listeners.down);
            this.canvas.removeEventListener('pointermove', this._listeners.move);
            this.canvas.removeEventListener('pointerup',   this._listeners.up);
            this.canvas.removeEventListener('pointercancel', this._listeners.up);
            this._listeners = null;
        }
        this.canvas = document.getElementById(canvasId);
        this.img    = document.getElementById(imgId);
        if (!this.canvas || !this.img) return;
        try { this.points = JSON.parse(pointsJson) || []; } catch(e) { this.points = []; }

        const attach = () => {
            this.syncSize();
            this.draw();
            this._listeners = {
                down: (e) => this.onPointerDown(e),
                move: (e) => this.onPointerMove(e),
                up:   (e) => this.onPointerUp(e),
            };
            this.canvas.addEventListener('pointerdown',  this._listeners.down);
            this.canvas.addEventListener('pointermove',  this._listeners.move);
            this.canvas.addEventListener('pointerup',    this._listeners.up);
            this.canvas.addEventListener('pointercancel',this._listeners.up);
        };

        if (this.img.complete && this.img.naturalWidth > 0) {
            attach();
        } else {
            this.img.addEventListener('load', attach, { once: true });
        }
    },

    syncSize() {
        if (!this.img || !this.canvas) return;
        const rect = this.img.getBoundingClientRect();
        const nw = this.img.naturalWidth  || rect.width;
        const nh = this.img.naturalHeight || rect.height;
        this.canvas.width  = nw;
        this.canvas.height = nh;
        this.canvas.style.width  = rect.width  + 'px';
        this.canvas.style.height = rect.height + 'px';
        this.scaleX = nw / rect.width;
        this.scaleY = nh / rect.height;
    },

    draw() {
        if (!this.canvas) return;
        const ctx = this.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        if (!this.points || this.points.length !== 4) return;
        const lw = Math.max(3, Math.round(this.canvas.width / 200));
        const hr = Math.max(14, Math.round(this.canvas.width / 50));  // handle radius
        // Draw quad
        ctx.fillStyle   = 'rgba(102,126,234,0.18)';
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth   = lw;
        ctx.beginPath();
        ctx.moveTo(this.points[0].x, this.points[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(this.points[i].x, this.points[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Draw handles
        this.points.forEach((pt, idx) => {
            ctx.fillStyle   = idx === this.dragIndex ? '#f5576c' : '#667eea';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth   = Math.max(2, lw - 1);
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, hr, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
    },

    toImageCoords(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (clientX - rect.left) * this.scaleX,
            y: (clientY - rect.top)  * this.scaleY,
        };
    },

    onPointerDown(e) {
        e.preventDefault();
        const pos = this.toImageCoords(e.clientX, e.clientY);
        const hitRadius = Math.max(24, Math.round(this.canvas.width / 35)) * this.scaleX;
        let closest = -1, minDist = Infinity;
        this.points.forEach((pt, i) => {
            const d = Math.hypot(pt.x - pos.x, pt.y - pos.y);
            if (d < minDist) { minDist = d; closest = i; }
        });
        if (minDist < hitRadius) {
            this.dragIndex = closest;
            this.canvas.setPointerCapture(e.pointerId);
        }
    },

    onPointerMove(e) {
        e.preventDefault();
        if (this.dragIndex < 0) return;
        const pos = this.toImageCoords(e.clientX, e.clientY);
        this.points[this.dragIndex] = {
            x: Math.max(0, Math.min(this.canvas.width,  pos.x)),
            y: Math.max(0, Math.min(this.canvas.height, pos.y)),
        };
        this.draw();
    },

    onPointerUp(e) { this.dragIndex = -1; this.draw(); },

    getPoints() { return JSON.stringify(this.points); },
};

function toggleLoading(isLoading) {
    if (dotnetHelper) {
        dotnetHelper.invokeMethodAsync('OnLoadingChanged', isLoading);
    }
}

function extractMrzInfo(result) {
    const parseResultInfo = {};
    let type = result.getFieldValue("documentCode");
    parseResultInfo['Document Type'] = JSON.parse(result.jsonString).CodeType;
    let nation = result.getFieldValue("issuingState");
    parseResultInfo['Issuing State'] = nation;
    let surName = result.getFieldValue("primaryIdentifier");
    parseResultInfo['Surname'] = surName;
    let givenName = result.getFieldValue("secondaryIdentifier");
    parseResultInfo['Given Name'] = givenName;
    let passportNumber = type === "P" ? result.getFieldValue("passportNumber") : result.getFieldValue("documentNumber");
    parseResultInfo['Passport Number'] = passportNumber;
    let nationality = result.getFieldValue("nationality");
    parseResultInfo['Nationality'] = nationality;
    let gender = result.getFieldValue("sex");
    parseResultInfo["Gender"] = gender;
    let birthYear = result.getFieldValue("birthYear");
    let birthMonth = result.getFieldValue("birthMonth");
    let birthDay = result.getFieldValue("birthDay");
    if (parseInt(birthYear) > (new Date().getFullYear() % 100)) {
        birthYear = "19" + birthYear;
    } else {
        birthYear = "20" + birthYear;
    }
    parseResultInfo['Date of Birth (YYYY-MM-DD)'] = birthYear + "-" + birthMonth + "-" + birthDay;
    let expiryYear = result.getFieldValue("expiryYear");
    let expiryMonth = result.getFieldValue("expiryMonth");
    let expiryDay = result.getFieldValue("expiryDay");
    if (parseInt(expiryYear) >= 60) {
        expiryYear = "19" + expiryYear;
    } else {
        expiryYear = "20" + expiryYear;
    }
    parseResultInfo["Date of Expiry (YYYY-MM-DD)"] = expiryYear + "-" + expiryMonth + "-" + expiryDay;
    return parseResultInfo;
}

async function showCameraResult(result) {
    let items = result.items;
    let txts = [];

    let type;
    if (currentMode === "barcode") {
        type = Dynamsoft.Core.EnumCapturedResultItemType.CRIT_BARCODE;
    } else if (currentMode === "mrz") {
        type = Dynamsoft.Core.EnumCapturedResultItemType.CRIT_TEXT_LINE;
    } else if (currentMode === "document") {
        type = Dynamsoft.Core.EnumCapturedResultItemType.CRIT_DETECTED_QUAD;
    }

    if (items != null && items.length > 0) {
        for (var i = 0; i < items.length; ++i) {
            let item = items[i];
            if (items[i].type === type) {
                txts.push(item.text);
                globalPoints = item.location.points;

                if (currentMode === "barcode") {
                    if (dotnetHelper) {
                        dotnetHelper.invokeMethodAsync('OnScanResultReceived', txts.join('\n'));
                    }
                } else if (currentMode === "mrz") {
                    if (txts.length > 0) {
                        let newText = item.text.replace(/\\n/g, '');
                        let parseResults = await parser.parse(newText);
                        let info = extractMrzInfo(parseResults);
                        if (dotnetHelper) {
                            dotnetHelper.invokeMethodAsync('OnScanResultReceived',
                                txts.join('\n') + '\n\n' + JSON.stringify(info, null, 2));
                        }
                    }
                }
            } else if (items[i].type === Dynamsoft.Core.EnumCapturedResultItemType.CRIT_ORIGINAL_IMAGE) {
                if (currentMode === "document") {
                    if (isCaptured) {
                        isCaptured = false;
                        await stopScanning();
                        let imageData = item.imageData.toCanvas().toDataURL();
                        if (dotnetHelper) {
                            dotnetHelper.invokeMethodAsync('OnDocumentCaptured', imageData,
                                JSON.stringify(globalPoints));
                        }
                    }
                }
            }
        }
    }
}

async function startScanning() {
    if (!isSDKReady) return;
    if (isDetecting) return;

    isDetecting = true;
    cvr.setInput(cameraEnhancer);

    if (currentMode === "mrz") {
        let scanRegion = {
            x: 10, y: 30, width: 80, height: 40, isMeasuredInPercentage: true
        };
        cameraEnhancer.setScanRegion(scanRegion);
        await cvr.initSettings("./full.json");
        cvr.startCapturing("ReadMRZ");
    } else if (currentMode === "barcode") {
        cameraEnhancer.setScanRegion(null);
        await cvr.resetSettings();
        cvr.startCapturing("ReadBarcodes_Default");
    } else if (currentMode === "document") {
        cameraEnhancer.setScanRegion(null);
        await cvr.resetSettings();
        let params = await cvr.getSimplifiedSettings("DetectDocumentBoundaries_Default");
        params.outputOriginalImage = true;
        await cvr.updateSettings("DetectDocumentBoundaries_Default", params);
        cvr.startCapturing("DetectDocumentBoundaries_Default");
    }
}

async function stopScanning() {
    if (!isDetecting) return;
    isDetecting = false;
    if (cvr != null) {
        await cvr.stopCapturing();
    }
    if (cameraView) {
        cameraView.clearAllInnerDrawingItems();
    }
}

// ── EXIF orientation helpers ─────────────────────────────────────────────────
function getExifOrientation(buffer) {
    try {
        const view = new DataView(buffer);
        if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG
        let offset = 2;
        while (offset < view.byteLength - 4) {
            const marker = view.getUint16(offset, false);
            const segLen  = view.getUint16(offset + 2, false);
            if (marker === 0xFFE1) {
                const exif = new DataView(buffer, offset + 4);
                const le   = exif.getUint16(0) === 0x4949;
                const ifd0 = exif.getUint32(4, le);
                const tags = exif.getUint16(ifd0, le);
                for (let i = 0; i < tags; i++) {
                    const t = ifd0 + 2 + i * 12;
                    if (exif.getUint16(t, le) === 0x0112) {
                        return exif.getUint16(t + 8, le);
                    }
                }
                return 1;
            }
            offset += 2 + segLen;
        }
    } catch (e) { /* ignore */ }
    return 1;
}

function applyOrientation(img, orientation) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    const swap = orientation >= 5;
    canvas.width  = swap ? h : w;
    canvas.height = swap ? w : h;
    const ctx = canvas.getContext('2d');
    switch (orientation) {
        case 2: ctx.transform(-1, 0, 0,  1,  w, 0); break;
        case 3: ctx.transform(-1, 0, 0, -1,  w, h); break;
        case 4: ctx.transform( 1, 0, 0, -1,  0, h); break;
        case 5: ctx.transform( 0, 1, 1,  0,  0, 0); break;
        case 6: ctx.transform( 0, 1,-1,  0,  h, 0); break;
        case 7: ctx.transform( 0,-1,-1,  0,  h, w); break;
        case 8: ctx.transform( 0,-1, 1,  0,  0, w); break;
        default: break;
    }
    ctx.drawImage(img, 0, 0);
    return canvas;
}

async function initCamera() {
    if (!Dynamsoft) return null;
    try {
        cameraView = await Dynamsoft.DCE.CameraView.createInstance();
        cameraEnhancer = await Dynamsoft.DCE.CameraEnhancer.createInstance(cameraView);
        cameras = await cameraEnhancer.getAllCameras();
        return cameras.map(c => c.label);
    } catch (ex) {
        console.error(ex);
        return null;
    }
}

window.jsFunctions = {
    initSDK: async function (dotnetRef, licenseKey) {
        dotnetHelper = dotnetRef;
        toggleLoading(true);
        try {
            await Dynamsoft.License.LicenseManager.initLicense(licenseKey, true);
            Dynamsoft.Core.CoreModule.loadWasm(["DBR", "DLR", "DDN"]);

            parser = await Dynamsoft.DCP.CodeParser.createInstance();
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD1_ID");
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD2_FRENCH_ID");
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD2_ID");
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD2_VISA");
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD3_PASSPORT");
            await Dynamsoft.DCP.CodeParserModule.loadSpec("MRTD_TD3_VISA");
            await Dynamsoft.CVR.CaptureVisionRouter.appendDLModelBuffer("MRZCharRecognition");
            await Dynamsoft.CVR.CaptureVisionRouter.appendDLModelBuffer("MRZTextLineRecognition");

            cvr = await Dynamsoft.CVR.CaptureVisionRouter.createInstance();
            cvr.addResultReceiver({
                onCapturedResultReceived: (result) => {
                    showCameraResult(result);
                }
            });

            isSDKReady = true;
            toggleLoading(false);
            return true;
        } catch (ex) {
            console.error(ex);
            toggleLoading(false);
            return false;
        }
    },

    initScanner: async function (dotnetRef, cameraViewId, cameraSelectId, mode) {
        dotnetHelper = dotnetRef;
        currentMode = mode;

        if (cameraEnhancer == null) {
            let cameraLabels = await initCamera();
            if (cameraLabels == null || cameraLabels.length === 0) {
                return [];
            }

            try {
                let uiElement = document.getElementById(cameraViewId);
                uiElement.append(cameraView.getUIElement());
                let shadowRoot = cameraView.getUIElement().shadowRoot;
                if (shadowRoot) {
                    let selCamera = shadowRoot.querySelector('.dce-sel-camera');
                    if (selCamera) selCamera.style.display = 'none';
                    let selResolution = shadowRoot.querySelector('.dce-sel-resolution');
                    if (selResolution) selResolution.style.display = 'none';
                }
            } catch (ex) {
                console.error(ex);
            }

            return cameraLabels;
        }

        // cameraEnhancer already exists (re-navigation) — re-attach the camera
        // view UI element to the freshly-rendered DOM container.
        try {
            const uiElement = document.getElementById(cameraViewId);
            const camUI = cameraView.getUIElement();
            if (uiElement && !uiElement.contains(camUI)) {
                uiElement.append(camUI);
            }
        } catch (ex) {
            console.error('initScanner re-attach error:', ex);
        }

        return cameras ? cameras.map(c => c.label) : [];
    },

    openCamera: async function (index) {
        if (cameras && cameras.length > index) {
            let wasDetecting = isDetecting;
            if (wasDetecting) {
                await stopScanning();
            }
            try {
                await cameraEnhancer.selectCamera(cameras[index]);
                cameraEnhancer.on("played", function () {
                    resolution = cameraEnhancer.getResolution();
                });
                cameraEnhancer.setPixelFormat(10);
                await cameraEnhancer.open();
            } catch (ex) {
                console.error(ex);
            }
            if (wasDetecting) {
                await startScanning();
            }
        }
    },

    startScanning: async function (mode) {
        currentMode = mode;
        await startScanning();
    },

    stopScanning: async function () {
        await stopScanning();
    },

    closeCamera: async function () {
        if (cameraEnhancer) {
            await stopScanning();
            await cameraEnhancer.close();
        }
    },

    captureDocument: function () {
        isCaptured = true;
    },

    decodeFile: async function (dotnetRef, base64Image, mode) {
        dotnetHelper = dotnetRef;
        if (!isSDKReady) return "SDK not ready";

        toggleLoading(true);
        // Clear any previous overlay
        const overlayCanvas = document.getElementById('reader_overlay');
        if (overlayCanvas) {
            overlayCanvas.getContext('2d').clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        try {
            let result;
            if (mode === "barcode") {
                await cvr.resetSettings();
                result = await cvr.capture(base64Image, "ReadBarcodes_Default");
                const txts = [];
                const locations = [];
                for (let item of result.items) {
                    if (item.type === Dynamsoft.Core.EnumCapturedResultItemType.CRIT_BARCODE) {
                        txts.push(item.text);
                        if (item.location && item.location.points) locations.push(item.location.points);
                    }
                }
                if (locations.length > 0) {
                    drawFileOverlay('reader_overlay', 'reader_image', locations,
                        '#2e7d32', 'rgba(76,175,80,0.18)');
                }
                toggleLoading(false);
                return txts.length > 0 ? txts.join('\n') : "No barcode found";
            } else if (mode === "mrz") {
                await cvr.initSettings("./full.json");
                result = await cvr.capture(base64Image, "ReadMRZ");
                const txts = [];
                const locations = [];
                let parseResultText = '';
                for (let item of result.items) {
                    if (item.type === Dynamsoft.Core.EnumCapturedResultItemType.CRIT_TEXT_LINE) {
                        txts.push(item.text);
                        if (item.location && item.location.points) locations.push(item.location.points);
                        let newText = item.text.replace(/\\n/g, '');
                        let parseResults = await parser.parse(newText);
                        parseResultText = JSON.stringify(extractMrzInfo(parseResults), null, 2);
                    }
                }
                if (locations.length > 0) {
                    drawFileOverlay('reader_overlay', 'reader_image', locations,
                        '#1565c0', 'rgba(102,126,234,0.18)');
                }
                toggleLoading(false);
                if (txts.length > 0) {
                    return txts.join('\n') + '\n\n' + parseResultText;
                }
                return "No MRZ found";
            } else if (mode === "document") {
                await cvr.resetSettings();
                result = await cvr.capture(base64Image, "DetectDocumentBoundaries_Default");
                for (let item of result.items) {
                    if (item.type === Dynamsoft.Core.EnumCapturedResultItemType.CRIT_DETECTED_QUAD) {
                        globalPoints = item.location.points;
                        toggleLoading(false);
                        return JSON.stringify(globalPoints);
                    }
                }
                toggleLoading(false);
                return "No document found";
            }
        } catch (ex) {
            console.error(ex);
            toggleLoading(false);
            return "Error: " + ex.message;
        }
        toggleLoading(false);
        return "Unknown mode";
    },

    initQuadEditor: function (canvasId, imgId, pointsJson) {
        quadEditor.init(canvasId, imgId, pointsJson);
    },

    getQuadEditorPoints: function () {
        return quadEditor.getPoints();
    },

    rectifyDocument: async function (base64Image, pointsJson) {
        try {
            const points = JSON.parse(pointsJson);
            if (!Array.isArray(points) || points.length !== 4) return null;
            return await new Promise((resolve) => {
                const img = new Image();
                img.onload = function () {
                    try {
                        const srcCanvas = document.createElement('canvas');
                        srcCanvas.width = img.naturalWidth;
                        srcCanvas.height = img.naturalHeight;
                        srcCanvas.getContext('2d').drawImage(img, 0, 0);
                        const result = warpPerspective(srcCanvas, points);
                        resolve(result ? result.toDataURL('image/jpeg', 0.92) : null);
                    } catch (e) {
                        console.error('warpPerspective error:', e);
                        resolve(null);
                    }
                };
                img.onerror = () => resolve(null);
                img.src = base64Image;
            });
        } catch (ex) {
            console.error('rectifyDocument error:', ex);
            return null;
        }
    },

    setImageUsingStreaming: async function (dotnetRef, imageId, imageStream, mode) {
        const arrayBuffer = await imageStream.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        const orientation = getExifOrientation(arrayBuffer);
        const blobUrl = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            const tempImg = new Image();
            tempImg.onload = function () {
                let correctedDataUrl;
                if (orientation <= 1) {
                    // No rotation needed — avoid unnecessary canvas redraw
                    correctedDataUrl = blobUrl;
                    let imgElement = document.getElementById(imageId);
                    if (imgElement) {
                        imgElement.src = correctedDataUrl;
                        imgElement.style.display = 'block';
                    }
                    // Still need base64 for SDK
                    const canvas = document.createElement('canvas');
                    canvas.width  = tempImg.naturalWidth;
                    canvas.height = tempImg.naturalHeight;
                    canvas.getContext('2d').drawImage(tempImg, 0, 0);
                    correctedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    URL.revokeObjectURL(blobUrl);
                    resolve(correctedDataUrl);
                } else {
                    const canvas = applyOrientation(tempImg, orientation);
                    URL.revokeObjectURL(blobUrl);
                    correctedDataUrl = canvas.toDataURL('image/jpeg', 0.92);
                    let imgElement = document.getElementById(imageId);
                    if (imgElement) {
                        imgElement.src = correctedDataUrl;
                        imgElement.style.display = 'block';
                    }
                    resolve(correctedDataUrl);
                }
            };
            tempImg.onerror = (e) => { URL.revokeObjectURL(blobUrl); reject(e); };
            tempImg.src = blobUrl;
        });
    },

    downloadImage: function (dataUrl, filename) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }
};

