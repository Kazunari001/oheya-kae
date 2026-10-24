import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {openingGeometry, area} from '../src/geometry.js';
import {resolveItems, solidParts} from '../src/scene.js';

const payload = JSON.parse(
    document.getElementById('oheya-kae-data').textContent,
);
const project = payload.project;
const room = project.room;
const getElement = (id) => document.getElementById(id);
const formatMillimeters = (v) =>
  v == null ? '不明' : `${Math.round(v).toLocaleString()} mm`;
const STATUS_NAMES = {
  confirmed: '確認済み',
  estimated: '推定',
  image: '画像記載',
  unknown: '不明',
};
let activeFurniture = resolveItems(project);
let report = payload.validation;
let selected = null;
let mode = '3d';
let showDimensions = true;
let showWalls = true;
let renderer;
let scene;
let perspective;
let top;
let camera;
let controls;
let group;
let wallGroup;
let labels = [];
let pickMeshes = [];
let span = 6;
let objectFilter = 'all';
let inspectedImageIds = new Set();
const detections = project.analysis?.detections ?? [];
const isPlaced = (item) => [item.width, item.depth, item.height, item.y]
    .every((value) => value != null);
const isProvisional = (item, keys) => keys.some((key) =>
  item?.evidence?.[key]?.status !== 'confirmed',
);
function visibleItem(item) {
  const collection = project.objects?.some((entry) => entry.id === item.id)
    ? 'objects' : 'furniture';
  return objectFilter === 'all' || objectFilter === collection;
}
const center = new THREE.Vector3();
function createElement(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) {
    node.textContent = text;
  }
  if (className) {
    node.className = className;
  }
  return node;
}
function showDetail(box = getElement('detail')) {
  box.replaceChildren();
  const furniture = activeFurniture.find(
      (furniture) => furniture.id === selected,
  );
  if (!furniture) {
    const detection = detections.find((entry) =>
      `detection:${entry.id}` === selected,
    );
    const opening = room?.openings.find((entry) => entry.id === selected);
    if (detection || opening) {
      box.append(createElement('b', detection ? `候補 ${detection.id}` :
        `${opening.type === 'door' ? 'ドア' : '窓'} ${opening.id}`));
      box.append(createElement('p', detection
        ? `${detection.decision} · ${detection.reason}`
        : `${formatMillimeters(opening.width)} × ` +
            `${formatMillimeters(opening.height)} · 壁 ${opening.wall}`));
      const details = detection ?? opening.evidence;
      box.append(createElement('pre', JSON.stringify(details, null, 2)));
    } else {
      box.append(
          createElement('b', '家具を選択'),
          createElement(
              'p',
              '3Dの家具またはリストをクリックすると、属性・寸法・根拠を確認できます。',
          ),
      );
    }
    return;
  }
  box.append(createElement('b', furniture.name));
  const detailList = createElement('dl');
  const fields = {
    category: '意味上の種類',
    kind: '種類',
    width: '幅',
    depth: '奥行',
    height: '高さ',
    x: '位置 X',
    y: '底面高さ Y',
    z: '位置 Z',
    rotation: '回転',
    color: '色',
  };
  for (const [key, title] of Object.entries(fields)) {
    const evidence = furniture.evidence[key];
    detailList.append(createElement('dt', title));
    const detailValue = createElement(
        'dd',
        key === 'rotation'
          ? `${furniture[key]}°`
          : ['kind', 'category', 'color'].includes(key)
            ? furniture[key]
            : formatMillimeters(furniture[key]),
    );
    detailValue.append(
        createElement(
            'div',
            `${STATUS_NAMES[evidence?.status] ?? '不明'}` +
            `${evidence?.note ? ' · ' + evidence.note : ''}`,
            'evidence',
        ),
    );
    detailList.append(detailValue);
  }
  box.append(
      detailList,
      createElement('p', furniture.id, 'evidence'),
  );
  if (furniture.parentId) {
    box.append(createElement('p',
        `支持関係: ${furniture.parentId} / ${furniture.attachment}`,
        'evidence'));
    box.append(createElement('p',
        `親からの位置: ${furniture.local.x}, ${furniture.local.y ?? '不明'}, ` +
        `${furniture.local.z} mm`, 'evidence'));
  }
  const children = activeFurniture.filter((item) =>
    item.parentId === furniture.id,
  );
  for (const child of children) {
    const button = createElement('button', `内容物: ${child.name}`);
    button.onclick = () => select(child.id);
    box.append(button);
  }
  const detection = detections.find((entry) => entry.targetId === furniture.id);
  if (detection) {
    box.append(createElement('p',
        `検出 ${detection.id} / ${detection.model} · ${detection.reason}`));
    box.append(createElement('p',
        `有無 ${detection.presenceProbability ?? '不明'} / ` +
        `枠 ${detection.boxConfidence ?? '不明'} / ` +
        `種類 ${detection.categoryConfidence ?? '不明'}`));
    box.append(createElement('p', '検出のconfidenceは実寸の確からしさを表しません。',
        'evidence'));
  }
  if (!isPlaced(furniture)) {
    box.append(createElement('p', '未配置: 寸法または設置高さが不明です。'));
  }
  if (furniture.kind === 'box') {
    box.append(createElement('p', '形状: 外接箱による仮表示', 'evidence'));
  }
  for (const note of furniture.uncertainties) {
    box.append(createElement('p', note, 'evidence'));
  }
}
function updatePanel() {
  getElement('room-name').textContent = room?.name ?? '部屋未作成';
  getElement('room-summary').textContent =
    '天井高 ' +
    `${formatMillimeters(room?.height)}` +
    ' · ' +
    `${room?.openings.length ?? 0}` +
    ' 開口部';
  getElement('area').textContent = room?.outline
    ? (Math.abs(area(room.outline)) / 1e6).toFixed(1) +
    (isProvisional(room, ['outline']) ? '（仮）' : '')
    : '—';
  getElement('count').textContent = activeFurniture.length;
  const displayed = activeFurniture.filter((item) =>
    isPlaced(item) && visibleItem(item),
  ).length;
  getElement('object-counts').textContent =
    `検出 ${detections.length || activeFurniture.length} · ` +
    `3D表示 ${displayed} · ` +
    `未配置 ${activeFurniture.filter((item) => !isPlaced(item)).length} · ` +
    `画像のみ ${detections.filter((entry) => !entry.targetId).length}`;
  const invalidIds = new Set(
      report.issues.flatMap((i) => i.objectIds),
  );
  getElement('furniture-list').replaceChildren();
  const ordered = [];
  function appendChildren(parentId, depth) {
    for (const item of activeFurniture.filter((entry) =>
      (entry.parentId ?? null) === parentId,
    )) {
      ordered.push({item, depth});
      appendChildren(item.id, depth + 1);
    }
  }
  appendChildren(null, 0);
  if (room) {
    appendChildren(room.id, 0);
  }
  for (const {item: furniture, depth} of ordered) {
    const collection = project.objects?.some((item) => item.id === furniture.id)
      ? 'objects' : 'furniture';
    if (objectFilter !== 'all' && objectFilter !== collection) {
      continue;
    }
    const button = createElement(
        'button',
        null,
        'furniture-button' +
        (furniture.id === selected ? ' selected' : ''),
    );
    button.dataset.id = furniture.id;
    button.style.paddingLeft = `${11 + Math.min(depth, 5) * 14}px`;
    button.setAttribute('aria-pressed', String(furniture.id === selected));
    const swatch = createElement('span', null, 'swatch');
    swatch.style.background = furniture.color;
    button.append(swatch);
    const copy = createElement('span', null, 'item-copy');
    copy.append(
        createElement('b', `${depth ? '↳ ' : ''}${furniture.name}`),
        createElement(
            'small',
            `${formatMillimeters(furniture.width)}` +
            ' × ' +
            `${formatMillimeters(furniture.depth)}` +
            ' × ' +
            `${formatMillimeters(furniture.height)}` +
            (isProvisional(furniture, ['width', 'depth', 'height'])
              ? '（仮寸法）' : '') + (isPlaced(furniture) ? '' : ' · 未配置'),
        ),
    );
    button.append(copy);
    if (invalidIds.has(furniture.id)) {
      button.append(createElement('span', '!', 'item-alert'));
    }
    button.addEventListener('click', () => select(furniture.id));
    getElement('furniture-list').append(button);
  }
  if (['all', 'openings'].includes(objectFilter)) {
    for (const opening of room?.openings ?? []) {
      const button = createElement('button',
          `${opening.type === 'door' ? 'ドア' : '窓'} ${opening.id}`,
          'furniture-button');
      button.dataset.id = opening.id;
      button.onclick = () => select(opening.id);
      getElement('furniture-list').append(button);
    }
  }
  if (['all', 'candidates'].includes(objectFilter)) {
    for (const detection of detections.filter((entry) => !entry.targetId)) {
      const button = createElement('button',
          `画像上の候補 ${detection.id} · ${detection.decision}`,
          'furniture-button');
      button.dataset.id = `detection:${detection.id}`;
      button.onclick = () => select(`detection:${detection.id}`);
      getElement('furniture-list').append(button);
    }
  }
  const validation = getElement('validation');
  validation.replaceChildren(
      createElement(
          'strong',
          report.geometryValid
            ? '● 形状・配置チェックを通過'
            : '● 配置に問題があります',
      ),
      createElement(
          'small',
          report.provisional
            ? `${report.corrections.length}項目が未確認です。結果は暫定です。`
            : '寸法・属性は確認済みです。',
      ),
  );
  if (report.issues.length) {
    const issueList = createElement('ul');
    for (const i of report.issues) {
      issueList.append(createElement('li', i.message));
    }
    validation.append(issueList);
  }
  getElement('corrections').replaceChildren();
  for (const correction of report.correctionGroups ?? []) {
    const row = createElement('li');
    const details = createElement('details');
    const name = activeFurniture.find((item) => item.id === correction.objectId)
        ?.name ?? correction.objectId ?? '部屋';
    details.append(createElement('summary', `${name} · ` +
    `${correction.type === 'measurement' ? '仮寸法・配置' : '属性'} ` +
    `${correction.entries.length}項目`));
    for (const entry of correction.entries) {
      details.append(createElement('p',
          `${entry.path} · ${STATUS_NAMES[entry.status]} · ${entry.note}`));
    }
    row.append(details);
    getElement('corrections').append(row);
  }
  for (const detection of report.detectionChecks ?? []) {
    const row = createElement('li');
    const button = createElement('button',
        `検出の曖昧さ: ${detection.id} · ${detection.reason}`);
    button.onclick = () => select(detection.targetId ??
        `detection:${detection.id}`);
    row.append(button);
    getElement('corrections').append(row);
  }
  showDetail();
}
function select(id) {
  const focused = document.activeElement?.closest('.furniture-button')
      ?.dataset.id;
  selected = id;
  updatePanel();
  if (focused) {
    [...getElement('furniture-list').querySelectorAll('button')]
        .find((button) => button.dataset.id === focused)
        ?.focus({preventScroll: true});
  }
  if (renderer) {
    drawScene();
  }
  drawDetectionBoxes();
  showDetail(getElement('image-selection'));
}
function sources() {
  const list = [
    ...(room?.images ?? []),
    ...project.furniture.flatMap((furniture) => furniture.images),
    ...(project.objects ?? []).flatMap((item) => item.images),
    ...(project.analysis?.images ?? []),
  ];
  const seen = new Set();
  let sourceIndex = 0;
  for (const source of list) {
    const imageData = source.data;
    if (seen.has(imageData)) {
      continue;
    }
    seen.add(imageData);
    const index = sourceIndex++;
    // Embedded JSON is untrusted here, even when CLI imports were validated.
    if (
      typeof imageData !== 'string' ||
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)
    ) {
      getElement('sources').append(createElement(
          'span', `${source.name}（表示できない画像形式）`, 'evidence',
      ));
      continue;
    }
    const a = createElement('a');
    a.href = imageData;
    a.download = source.name;
    const img = createElement('img');
    img.src = imageData;
    img.alt = source.name;
    a.append(img, createElement('span', source.name));
    getElement('sources').append(a);
    const inspect = createElement('button', `${source.name}を拡大・検出枠を確認`);
    inspect.onclick = () => {
      // Enforce the URL boundary at this asynchronous sink as well.
      if (
        typeof imageData !== 'string' ||
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)
      ) {
        getElement('status').textContent = '元画像のURLが不正です。';
        return;
      }
      inspectedImageIds = new Set(Object.keys(payload.sourceIndexes ?? {})
          .filter((id) =>
            payload.sourceIndexes[id] === index,
          ));
      getElement('inspection-image').src = imageData;
      getElement('inspection-image').alt = source.name;
      showDetail(getElement('image-selection'));
      drawDetectionBoxes();
      getElement('image-dialog').showModal();
    };
    getElement('sources').append(inspect);
  }
  if (!list.length) {
    getElement('sources').append(
        createElement('span', '画像なし', 'evidence'),
    );
  }
}

function drawDetectionBoxes() {
  const focused = document.activeElement?.dataset.detectionId;
  getElement('image-boxes').replaceChildren();
  for (const detection of detections.filter((entry) =>
    inspectedImageIds.has(entry.imageId),
  )) {
    const target = activeFurniture.find((item) =>
      item.id === detection.targetId,
    );
    const isOpening = room?.openings.some((item) =>
      item.id === detection.targetId,
    );
    if (objectFilter !== 'all' && !(target && visibleItem(target)) &&
        !(isOpening && objectFilter === 'openings') &&
        !(!detection.targetId && objectFilter === 'candidates')) {
      continue;
    }
    let [x, y, width, height] = detection.box;
    const region = project.analysis.regions.find((entry) =>
      entry.id === detection.regionId,
    );
    if (region) {
      x = region.box[0] + x * region.box[2];
      y = region.box[1] + y * region.box[3];
      width *= region.box[2];
      height *= region.box[3];
    }
    const id = detection.targetId ?? `detection:${detection.id}`;
    const button = createElement('button', detection.id, 'detection-box');
    button.dataset.detectionId = detection.id;
    button.style.left = `${x * 100}%`;
    button.style.top = `${y * 100}%`;
    button.style.width = `${width * 100}%`;
    button.style.height = `${height * 100}%`;
    button.setAttribute('aria-label', `検出 ${detection.id}`);
    button.setAttribute('aria-pressed', String(id === selected));
    button.onclick = () => select(id);
    getElement('image-boxes').append(button);
    if (focused === detection.id) {
      button.focus({preventScroll: true});
    }
  }
}
/**
 * Add a box mesh in renderer coordinates; every length here is in meters.
 * @param {!THREE.Object3D} parent Scene group receiving the mesh.
 * @param {number} w Width in meters.
 * @param {number} h Height in meters.
 * @param {number} d Depth in meters.
 * @param {number} x Center X coordinate in meters.
 * @param {number} y Center Y coordinate in meters.
 * @param {number} z Center Z coordinate in meters.
 * @param {string} color CSS color.
 * @param {boolean} transparent Whether to use translucent material.
 * @return {!THREE.Mesh} The added mesh.
 */
function box(parent, w, h, d, x, y, z, color, transparent = false) {
  const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.8,
        transparent,
        opacity: transparent ? 0.25 : 1,
      }),
  );
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}
/**
 * Register a DOM label anchored to world coordinates in meters.
 * @param {string} text Label text.
 * @param {number} x World X in meters.
 * @param {number} y World Y in meters.
 * @param {number} z World Z in meters.
 * @param {string} className Additional label class.
 * @return {void}
 */
function label(text, x, y, z, className = '') {
  const node = createElement('div', text, 'dimension ' + className);
  getElement('labels').append(node);
  labels.push({el: node, position: new THREE.Vector3(x, y, z)});
}
function floorMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d');
  c.fillStyle = '#d6c8ab';
  c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i % 2 ? '#d5c7aa' : '#deceb0';
    c.fillRect(0, i * 64, 512, 63);
    c.strokeStyle = '#c4b594';
    c.beginPath();
    c.moveTo((i % 2) * 256, i * 64);
    c.lineTo((i % 2) * 256, i * 64 + 64);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.8, 0.8);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: t,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
}
/**
 * Convert furniture from mm to meters and add its mesh, pick targets and label.
 * Unknown dimensions omit the item from the 3D scene.
 * @param {!Object} furniture Normalized furniture with rotation in degrees.
 * @param {boolean} isInvalid Whether validation requires an error highlight.
 * @return {void}
 */
function makeFurniture(furniture, isInvalid) {
  if (
    !visibleItem(furniture) ||
    [furniture.width, furniture.depth, furniture.height].some(
        (v) => v == null,
    ) || furniture.y == null
  ) {
    return;
  }
  const meshGroup = new THREE.Group();
  meshGroup.userData.furnitureId = furniture.id;
  group.add(meshGroup);
  meshGroup.position.set(
      furniture.x / 1000, furniture.y / 1000, furniture.z / 1000,
  );
  meshGroup.rotation.y = (furniture.rotation * Math.PI) / 180;
  const w = furniture.width / 1000;
  const d = furniture.depth / 1000;
  const h = furniture.height / 1000;
  const col = isInvalid ? '#cb765c' : furniture.color;
  const openShelf = furniture.kind === 'shelf' && furniture.supports.length > 0;
  const openFrame = openShelf || furniture.kind === 'clothes_rack';
  if (openFrame || ['books', 'screen', 'lamp'].includes(furniture.kind)) {
    for (const part of solidParts(furniture)) {
      const mesh = box(meshGroup, part.width / 1000, part.height / 1000,
          part.depth / 1000, part.x / 1000,
          (part.y + part.height / 2) / 1000, part.z / 1000, col);
      mesh.userData.id = furniture.id;
      pickMeshes.push(mesh);
    }
  } else if (furniture.kind === 'clock') {
    const face = new THREE.Mesh(
        new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
        new THREE.MeshStandardMaterial({color: col}),
    );
    face.rotation.x = Math.PI / 2;
    face.scale.set(w, d, h);
    face.position.y = h / 2;
    meshGroup.add(face);
    box(meshGroup, w * 0.04, h * 0.28, d * 0.1,
        0, h * 0.6, d * 0.46, '#283d37');
    box(meshGroup, w * 0.25, h * 0.04, d * 0.1,
        w * 0.1, h / 2, d * 0.46, '#283d37');
  } else if (['desk', 'table'].includes(furniture.kind)) {
    const thick = Math.min(0.06, h / 5);
    box(meshGroup, w, thick, d, 0, h - thick / 2, 0, col);
    const leg = Math.min(0.045, w / 8, d / 8);
    for (const x of [-w / 2 + leg, w / 2 - leg]) {
      for (const z of [-d / 2 + leg, d / 2 - leg]) {
        box(
            meshGroup,
            leg,
            h - thick,
            leg,
            x,
            (h - thick) / 2,
            z,
            '#5b625d',
        );
      }
    }
  } else if (furniture.kind === 'bed') {
    box(meshGroup, w, h * 0.3, d, 0, h * 0.15, 0, col);
    box(
        meshGroup,
        w * 0.97,
        h * 0.65,
        d * 0.95,
        0,
        h * 0.625,
        0,
        '#eeeade',
    );
    box(
        meshGroup,
        w * 0.65,
        h * 0.05,
        d * 0.2,
        0,
        h * 0.975,
        -d * 0.32,
        '#d4d8c8',
    );
  } else if (['sofa', 'chair'].includes(furniture.kind)) {
    box(meshGroup, w, h * 0.45, d, 0, h * 0.225, 0, col);
    box(
        meshGroup,
        w,
        h * 0.55,
        d * 0.16,
        0,
        h * 0.725,
        -d * 0.42,
        col,
    );
    if (furniture.kind === 'sofa') {
      for (const x of [-w * 0.45, w * 0.45]) {
        box(meshGroup, w * 0.1, h * 0.6, d, x, h * 0.3, 0, col);
      }
    }
  } else {
    const isAppliance = furniture.kind === 'appliance';
    // Recess the body so the panel and handle remain visible inside the
    // original depth envelope used for placement and collision checks.
    box(meshGroup, w, h, isAppliance ? d * 0.96 : d,
        0, h / 2, isAppliance ? -d * 0.02 : 0, col);
    if (isAppliance) {
      box(meshGroup, w * 0.8, h * 0.65, d * 0.02,
          0, h * 0.45, d * 0.48, '#344343');
      box(meshGroup, w * 0.6, h * 0.04, d * 0.04,
          0, h * 0.83, d * 0.48, '#a5a8ad');
    }
    if (['shelf', 'cabinet'].includes(furniture.kind)) {
      for (let j = 1; j < 4; j++) {
        box(
            meshGroup,
            w * 0.98,
            0.012,
            0.012,
            0,
            (h * j) / 4,
            d / 2 + 0.003,
            '#5e6056',
        );
      }
    }
  }
  // Keep the full outline, but let clicks pass through an open shelf's gaps.
  const bounds = new THREE.BoxGeometry(w, h, d);
  const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(bounds),
      new THREE.LineBasicMaterial({
        color:
        selected === furniture.id || selected === furniture.parentId
          ? '#224e3d'
          : isInvalid
            ? '#a84430'
            : '#6c7565',
        transparent: true,
        opacity: selected === furniture.id || selected === furniture.parentId ||
            isInvalid ? 1 : 0.25,
      }),
  );
  outline.position.y = h / 2;
  meshGroup.add(outline);
  if (openFrame) {
    bounds.dispose();
  } else {
    const hit = new THREE.Mesh(
        bounds,
        new THREE.MeshBasicMaterial({visible: false}),
    );
    hit.position.y = h / 2;
    hit.userData.id = furniture.id;
    meshGroup.add(hit);
    pickMeshes.push(hit);
  }
  if (!furniture.parentId || selected === furniture.id ||
      selected === furniture.parentId) {
    label(
        `${furniture.name}` +
        ' · ' +
        `${Math.round(furniture.width)}` +
        ' × ' +
        `${Math.round(furniture.depth)}` +
        (isProvisional(furniture, ['width', 'depth']) ? '（仮）' : ''),
        furniture.x / 1000,
        furniture.y / 1000 + h + 0.12,
        furniture.z / 1000,
        'furniture',
    );
  }
}
/**
 * Release generated geometry, textures and materials before replacing a group.
 * @param {!THREE.Group} meshGroup Group owned by this viewer.
 * @return {void}
 */
function disposeGroup(meshGroup) {
  meshGroup.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material)
        ? o.material
        : [o.material]) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
  scene.remove(meshGroup);
}
/**
 * Rebuild room and furniture meshes from the active layout.
 * Split wall spans at opening boundaries to leave door and window gaps.
 * Project lengths are mm; every Three.js position is converted to meters.
 * @return {void}
 */
function drawScene() {
  if (group) {
    disposeGroup(group);
  }
  group = new THREE.Group();
  scene.add(group);
  wallGroup = new THREE.Group();
  group.add(wallGroup);
  pickMeshes = [];
  labels = [];
  getElement('labels').replaceChildren();
  const invalidIds = new Set(
      report.issues.flatMap((i) => i.objectIds),
  );
  if (room?.outline) {
    const shape = new THREE.Shape();
    room.outline.forEach(([x, z], i) =>
      i
        ? shape.lineTo(x / 1000, -z / 1000)
        : shape.moveTo(x / 1000, -z / 1000),
    );
    shape.closePath();
    const floor = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        floorMaterial(),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.002;
    group.add(floor);
    const height = (room.height ?? 2400) / 1000;
    for (let i = 0; i < room.outline.length; i++) {
      const a = room.outline[i];
      const b = room.outline[(i + 1) % room.outline.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]) / 1000;
      const angle = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      const wallMeshGroup = new THREE.Group();
      wallMeshGroup.position.set(a[0] / 1000, 0, a[1] / 1000);
      wallMeshGroup.rotation.y = angle;
      wallGroup.add(wallMeshGroup);
      const openings = room.openings.filter((o) => o.wall === i);
      const breaks = [
        0,
        length,
        ...openings.flatMap((o) => [
          o.offset / 1000,
          (o.offset + o.width) / 1000,
        ]),
      ].sort((x, y) => x - y);
      for (let j = 1; j < breaks.length; j++) {
        const start = breaks[j - 1];
        const end = breaks[j];
        if (end - start < 1e-7) {
          continue;
        }
        const mid = (start + end) / 2;
        const covered = openings.filter(
            (o) =>
              mid > o.offset / 1000 &&
              mid < (o.offset + o.width) / 1000,
        );
        const ys = [
          0,
          height,
          ...covered.flatMap((o) => [
            o.sill / 1000,
            (o.sill + o.height) / 1000,
          ]),
        ]
            .filter((y) => y >= 0 && y <= height)
            .sort((x, y) => x - y);
        for (let k = 1; k < ys.length; k++) {
          const low = ys[k - 1];
          const high = ys[k];
          const cy = (low + high) / 2;
          if (
            high - low < 1e-7 ||
            covered.some(
                (o) =>
                  cy > o.sill / 1000 &&
                  cy < (o.sill + o.height) / 1000,
            )
          ) {
            continue;
          }
          box(
              wallMeshGroup,
              end - start,
              high - low,
              0.08,
              mid,
              cy,
              0,
              '#f2f1e6',
              true,
          );
        }
      }
      const edgeLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(a[0] / 1000, 0.015, a[1] / 1000),
            new THREE.Vector3(b[0] / 1000, 0.015, b[1] / 1000),
          ]),
          new THREE.LineBasicMaterial({color: '#74866a'}),
      );
      group.add(edgeLine);
      label(
          `${Math.round(length * 1000).toLocaleString()} mm` +
          (isProvisional(room, ['outline']) ? '（仮）' : ''),
          (a[0] + b[0]) / 2000,
          0.035,
          (a[1] + b[1]) / 2000,
      );
    }
    for (const o of room.openings) {
      if (!['all', 'openings'].includes(objectFilter)) {
        continue;
      }
      const openingShape = openingGeometry(room, o);
      const w = o.width / 1000;
      const openingGroup = new THREE.Group();
      openingGroup.position.set(
          (openingShape.start[0] + openingShape.end[0]) / 2000,
          0,
          (openingShape.start[1] + openingShape.end[1]) / 2000,
      );
      openingGroup.rotation.y = -Math.atan2(
          openingShape.end[1] - openingShape.start[1],
          openingShape.end[0] - openingShape.start[0],
      );
      group.add(openingGroup);
      const hit = box(openingGroup, w, o.height / 1000, 0.04,
          0, (o.sill + o.height / 2) / 1000, 0, '#ffffff', true);
      hit.material.visible = false;
      hit.userData.id = o.id;
      pickMeshes.push(hit);
      if (o.type === 'window') {
        box(
            openingGroup,
            w,
            o.height / 1000,
            0.04,
            0,
            (o.sill + o.height / 2) / 1000,
            0,
            '#83b0b8',
            true,
        );
        box(
            openingGroup,
            w,
            0.035,
            0.1,
            0,
            o.sill / 1000,
            0,
            '#739598',
        );
      } else {
        box(
            openingGroup,
            w,
            0.018,
            0.11,
            0,
            0.012,
            0,
            invalidIds.has(o.id) ? '#bb6249' : '#a3b28e',
        );
        const shape = new THREE.Shape();
        openingShape.zone.forEach(([x, z], i) =>
          i
            ? shape.lineTo(x / 1000, -z / 1000)
            : shape.moveTo(x / 1000, -z / 1000),
        );
        shape.closePath();
        const zone = new THREE.Mesh(
            new THREE.ShapeGeometry(shape),
            new THREE.MeshBasicMaterial({
              color: invalidIds.has(o.id) ? '#c66a50' : '#a4b395',
              opacity: 0.22,
              transparent: true,
              side: THREE.DoubleSide,
            }),
        );
        zone.rotation.x = -Math.PI / 2;
        zone.position.y = 0.008;
        group.add(zone);
      }
      label(
          `${o.type === 'door' ? 'ドア' : '窓'}` +
          ' ' +
          `${Math.round(o.width)}` +
          ' mm' + (isProvisional(o, ['width']) ? '（仮）' : ''),
          openingGroup.position.x,
          0.08,
          openingGroup.position.z,
      );
    }
  }
  for (const furniture of activeFurniture) {
    makeFurniture(furniture, invalidIds.has(furniture.id));
  }
  wallGroup.visible = showWalls && mode === '3d';
  group.updateMatrixWorld(true);
}
function resetView() {
  top.zoom = 1;
  perspective.position.set(
      center.x + span * 1.05,
      span * 1.15,
      center.z + span * 1.05,
  );
  perspective.lookAt(center);
  top.position.set(center.x, span * 2, center.z);
  top.up.set(0, 0, -1);
  top.lookAt(center);
  controls.target.copy(center);
  controls.update();
  resize();
}
function setMode(next) {
  mode = next;
  camera = mode === '3d' ? perspective : top;
  controls.dispose();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.enableRotate = mode === '3d';
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.minDistance = 0.1;
  controls.maxDistance = span * 10;
  getElement('view-3d').classList.toggle('active', mode === '3d');
  getElement('view-top').classList.toggle('active', mode === 'top');
  getElement('view-3d').setAttribute(
      'aria-pressed',
      String(mode === '3d'),
  );
  getElement('view-top').setAttribute(
      'aria-pressed',
      String(mode === 'top'),
  );
  wallGroup.visible = showWalls && mode === '3d';
  controls.update();
  resize();
}
function resize() {
  const w = getElement('viewport').clientWidth;
  const h = getElement('viewport').clientHeight;
  renderer.setSize(w, h);
  perspective.aspect = w / h;
  perspective.updateProjectionMatrix();
  const half = span * 0.72;
  top.left = (-half * w) / h;
  top.right = (half * w) / h;
  top.top = half;
  top.bottom = -half;
  top.updateProjectionMatrix();
}
/**
 * Initialize renderer, cameras, picking and the animation loop.
 * Requires the viewer template DOM; dimensions enter in mm and render in m.
 * @return {void}
 */
function init() {
  scene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  getElement('viewport').append(renderer.domElement);
  scene.add(new THREE.HemisphereLight('#ffffff', '#a7b095', 2.3));
  const sun = new THREE.DirectionalLight('#fff8e5', 2.2);
  sun.position.set(3, 8, 5);
  scene.add(sun);
  const points = room?.outline ?? [
    [0, 0],
    [4000, 4000],
  ];
  const xs = points.map((v) => v[0] / 1000);
  const zs = points.map((v) => v[1] / 1000);
  center.set(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      0,
      (Math.min(...zs) + Math.max(...zs)) / 2,
  );
  span = Math.max(
      2,
      Math.max(...xs) - Math.min(...xs),
      Math.max(...zs) - Math.min(...zs),
  );
  perspective = new THREE.PerspectiveCamera(
      42,
      1,
      0.01,
      span * 100,
  );
  top = new THREE.OrthographicCamera(
      -4,
      4,
      4,
      -4,
      0.01,
      span * 100,
  );
  camera = perspective;
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.maxDistance = span * 10;
  controls.minDistance = 0.1;
  drawScene();
  resetView();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = [e.clientX, e.clientY];
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (
      !down ||
      Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5
    ) {
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickMeshes)[0];
    select(hit?.object.userData.id ?? null);
  });
  new ResizeObserver(resize).observe(getElement('viewport'));
  function frame() {
    requestAnimationFrame(frame);
    controls.update();
    renderer.render(scene, camera);
    const occupied = [];
    for (const label of labels) {
      const projected = label.position.clone().project(camera);
      label.el.style.display =
        showDimensions &&
        projected.z >= -1 &&
        projected.z <= 1 &&
        Math.abs(projected.x) < 1 &&
        Math.abs(projected.y) < 1
          ? 'block'
          : 'none';
      const left = ((projected.x + 1) / 2) * renderer.domElement.clientWidth;
      const top = ((-projected.y + 1) / 2) * renderer.domElement.clientHeight;
      label.el.style.left = `${left}px`;
      label.el.style.top = `${top}px`;
      if (label.el.style.display !== 'none' &&
          label.el.classList.contains('furniture')) {
        const bounds = label.el.getBoundingClientRect();
        if (occupied.some((other) => bounds.left < other.right &&
            bounds.right > other.left && bounds.top < other.bottom &&
            bounds.bottom > other.top)) {
          label.el.style.display = 'none';
        } else {
          occupied.push(bounds);
        }
      } else if (label.el.style.display !== 'none') {
        occupied.push(label.el.getBoundingClientRect());
      }
    }
  }
  frame();
  window.oheyaKaeViewer = {
    get mode() {
      return mode;
    },
    get selected() {
      return selected;
    },
    get proposal() {
      return getElement('proposal').value;
    },
    get meshCount() {
      return new Set(pickMeshes.map((mesh) => mesh.userData.id).filter((id) =>
        activeFurniture.some((item) => item.id === id),
      )).size;
    },
    get worldPositions() {
      return Object.fromEntries(group.children
          .filter((item) => item.userData.furnitureId)
          .map((item) => [item.userData.furnitureId, {
            x: item.position.x * 1000, y: item.position.y * 1000,
            z: item.position.z * 1000,
            rotation: item.rotation.y * 180 / Math.PI,
          }]));
    },
    get renderer() {
      return renderer;
    },
    get cameraPosition() {
      return camera.position.toArray();
    },
    get colors() {
      return Object.fromEntries(
          group.children
              .filter((meshGroup) => meshGroup.userData.furnitureId)
              .map((meshGroup) => [
                meshGroup.userData.furnitureId,
                meshGroup.children
                    .find((c) => c.isMesh)
                    .material.color.getHexString(),
              ]),
      );
    },
  };
  getElement('view-3d').onclick = () => setMode('3d');
  getElement('view-top').onclick = () => setMode('top');
  getElement('reset').onclick = resetView;
  getElement('walls').onclick = () => {
    showWalls = !showWalls;
    getElement('walls').setAttribute(
        'aria-pressed',
        String(showWalls),
    );
    wallGroup.visible = showWalls && mode === '3d';
  };
  getElement('dimensions').onclick = () => {
    showDimensions = !showDimensions;
    getElement('dimensions').setAttribute(
        'aria-pressed',
        String(showDimensions),
    );
  };
}
updatePanel();
sources();
getElement('object-filter').onchange = (event) => {
  objectFilter = event.target.value;
  updatePanel();
  drawDetectionBoxes();
  if (renderer) {
    drawScene();
  }
};
getElement('close-image').onclick = () => getElement('image-dialog').close();
getElement('image-zoom').oninput = (event) => {
  getElement('image-stage').style.width = `${event.target.value}%`;
};
for (const v of payload.proposals) {
  const o = createElement('option', v.name);
  o.value = v.id;
  getElement('proposal').append(o);
}
getElement('proposal').addEventListener('change', () => {
  const proposal = payload.proposals.find(
      (v) => v.id === getElement('proposal').value,
  );
  const furniture = proposal
    ? project.furniture.map((furniture) => {
      const placement = proposal.placements.find((v) => v.id === furniture.id);
      if (!placement) {
        return furniture;
      }
      return {
        ...furniture,
        ...placement,
        evidence: {
          ...furniture.evidence,
          ...Object.fromEntries(
              ['x', 'z', 'rotation'].map((k) => [
                k,
                {
                  status: 'estimated',
                  note: '配置案の位置・回転。実位置は未確認。',
                },
              ]),
          ),
        },
      };
    })
    : project.furniture;
  activeFurniture = resolveItems({...project, furniture});
  report = proposal?.validation ?? payload.validation;
  getElement('proposal-note').textContent = proposal
    ? `${proposal.intent} ${proposal.notes.join(' ')}`
    : '';
  updatePanel();
  if (renderer) {
    drawScene();
  }
});
if (!room?.outline) {
  getElement('status').textContent =
    '部屋の輪郭が不明です。CLIで寸法・輪郭を入力してHTMLを再出力してください。';
}
try {
  init();
} catch (e) {
  getElement('status').textContent =
    '3D表示を開始できません。WebGLが有効なGoogle Chromeをご利用ください。' +
    '属性・元画像・検証結果は左側で確認できます。';
  console.error(e);
}
