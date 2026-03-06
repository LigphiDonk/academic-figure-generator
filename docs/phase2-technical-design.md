# Phase 2 技术文档：可编辑输出实现方案

> 版本: 1.0 | 日期: 2026-03-06 | 状态: 技术评审

---

## 1. 架构概览

### 1.1 系统架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ExportButton  │  │ExportHistory │  │  下载触发      │  │
│  │  Group       │  │   Panel      │  │(blob.ts复用)   │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼─────────────────┼──────────────────┼──────────┘
          │ POST             │ GET              │ GET
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                    FastAPI Backend                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              exports.py (API Router)                 │ │
│  │  POST /images/{id}/export                           │ │
│  │  POST /prompts/{id}/export                          │ │
│  │  GET  /exports/{id}                                 │ │
│  │  GET  /exports/{id}/download                        │ │
│  │  GET  /prompts/{id}/exports                         │ │
│  └──────────────────────┬──────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────┘
                          │ Celery dispatch
                          ▼
┌─────────────────────────────────────────────────────────┐
│                    Celery Worker                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           export_tasks.py                            │ │
│  │                                                      │ │
│  │  1. 加载 Image (PNG from MinIO)                     │ │
│  │  2. 加载 Prompt (FigureSpec V1 + active_prompt)     │ │
│  │  3. Claude Vision → FigureSpec V2 (enrichment)      │ │
│  │  4. Pydantic 校验 V2                                │ │
│  │  5. 调用 Exporter                                    │ │
│  │     ├── svg_exporter.py → SVG bytes                 │ │
│  │     └── drawio_exporter.py → XML bytes              │ │
│  │  6. 上传 MinIO                                       │ │
│  │  7. 更新 Export 记录                                  │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
┌──────────────────┐          ┌──────────────────┐
│  Claude Vision   │          │      MinIO       │
│  (Enrichment)    │          │  (File Storage)  │
│  V1+PNG → V2     │          │  exports/{uid}/  │
└──────────────────┘          └──────────────────┘
```

### 1.2 核心流程

```
用户点击"导出 SVG"
    │
    ▼
POST /images/{image_id}/export  { format: "svg" }
    │
    ▼
创建 Export 记录 (status=pending) → 返回 export_id + task_id
    │
    ▼
Celery: export_figure_task
    │
    ├── 1. 从 MinIO 下载原始 PNG (image.storage_path)
    ├── 2. 从 DB 加载 FigureSpec V1 (prompt.figure_spec)
    ├── 3. 检查是否已有缓存的 V2 (同 prompt 之前导出过)
    │      ├── 有 → 跳过 Claude 调用，直接复用 V2
    │      └── 无 → 调用 Claude Vision (base64 PNG + V1 + prompt → V2 JSON)
    ├── 4. Pydantic 校验 V2 schema
    ├── 5. 存储 V2 到 exports.figure_spec_v2
    ├── 6. svg_exporter.export(v2) → SVG bytes
    ├── 7. 上传 SVG 到 MinIO: exports/{user_id}/{export_id}.svg
    └── 8. 更新 Export 记录 (status=completed, storage_path, file_size)
    │
    ▼
前端轮询 GET /exports/{export_id} → status=completed
    │
    ▼
GET /exports/{export_id}/download → 触发浏览器下载
```

---

## 2. 数据库设计

### 2.1 新建 `exports` 表

```sql
CREATE TABLE exports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_id        UUID REFERENCES images(id) ON DELETE SET NULL,
    prompt_id       UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- 导出配置
    format          VARCHAR(20) NOT NULL,  -- "svg" | "drawio"
    canvas_width    INTEGER NOT NULL DEFAULT 1600,
    canvas_height   INTEGER NOT NULL DEFAULT 900,

    -- FigureSpec V2 (结构化几何描述)
    figure_spec_v2  JSONB,

    -- 导出结果
    storage_path    VARCHAR(500),  -- MinIO path: exports/{user_id}/{export_id}.{ext}
    file_size_bytes INTEGER,
    export_status   VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending|processing|completed|failed
    export_task_id  VARCHAR(100),  -- Celery task ID
    export_error    TEXT,
    export_duration_ms INTEGER,

    -- 时间戳
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_exports_prompt_id ON exports(prompt_id);
CREATE INDEX idx_exports_user_id ON exports(user_id);
CREATE INDEX idx_exports_image_id ON exports(image_id);
CREATE INDEX idx_exports_status ON exports(export_status);
```

### 2.2 SQLAlchemy Model

**文件**: `backend/app/models/export.py`

```python
class Export(Base):
    __tablename__ = "exports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("images.id", ondelete="SET NULL"))
    prompt_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("prompts.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"))

    format: Mapped[str] = mapped_column(String(20))
    canvas_width: Mapped[int] = mapped_column(Integer, default=1600)
    canvas_height: Mapped[int] = mapped_column(Integer, default=900)

    figure_spec_v2: Mapped[Optional[dict]] = mapped_column(JSONB)
    storage_path: Mapped[Optional[str]] = mapped_column(String(500))
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer)
    export_status: Mapped[str] = mapped_column(String(20), default="pending")
    export_task_id: Mapped[Optional[str]] = mapped_column(String(100))
    export_error: Mapped[Optional[str]] = mapped_column(Text)
    export_duration_ms: Mapped[Optional[int]] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
```

---

## 3. FigureSpec V2 Schema

### 3.1 完整 JSON Schema

**文件**: `backend/app/exporters/base.py`

```python
class V2Label(BaseModel):
    text: str
    font_size: int = 14
    font_family: str = "Helvetica"
    font_weight: str = "normal"  # "normal" | "bold"
    color: str = "#333333"
    position: str = "center"  # "center" | "top" | "bottom" | "left" | "right"

class V2Element(BaseModel):
    id: str
    type: str  # "rect" | "rounded_rect" | "circle" | "ellipse" | "diamond" |
               # "parallelogram" | "trapezoid" | "hexagon" | "triangle" | "cylinder" | "cloud"
    x: float
    y: float
    width: float
    height: float
    fill: str = "#FFFFFF"          # #RRGGBB
    stroke: str = "#000000"        # #RRGGBB
    stroke_width: float = 1.0
    corner_radius: float = 0       # 仅 rounded_rect
    opacity: float = 1.0
    label: V2Label | None = None
    children: list["V2Element"] = []

class V2Connection(BaseModel):
    id: str
    from_element: str              # 源元素 id
    to_element: str                # 目标元素 id
    from_anchor: str = "right"     # "top"|"bottom"|"left"|"right"|"top-left"|...
    to_anchor: str = "left"
    type: str = "arrow"            # "arrow"|"dashed_arrow"|"bidirectional"|"line"|"dashed_line"
    label: str | None = None
    label_position: str = "above"  # "above" | "below" | "center"
    waypoints: list[list[float]] = []  # [[x1,y1], [x2,y2], ...]
    stroke: str = "#666666"
    stroke_width: float = 1.5
    dash_pattern: str | None = None  # "5,3" SVG dash-array 格式

class V2TextBlock(BaseModel):
    id: str
    x: float
    y: float
    text: str
    font_size: int = 14
    font_family: str = "Helvetica"
    font_weight: str = "normal"
    color: str = "#000000"
    anchor: str = "start"  # "start" | "middle" | "end"

class V2LegendItem(BaseModel):
    color: str
    label: str

class V2Legend(BaseModel):
    x: float
    y: float
    items: list[V2LegendItem]

class V2Canvas(BaseModel):
    width: int = 1600
    height: int = 900
    background: str = "#FFFFFF"

class FigureSpecV2(BaseModel):
    version: str = "2.0"
    figure_type: str
    canvas: V2Canvas
    elements: list[V2Element] = []
    connections: list[V2Connection] = []
    text_blocks: list[V2TextBlock] = []
    legends: list[V2Legend] = []
```

### 3.2 V1 → V2 对照

| V1 字段 | V2 对应 | 变化 |
|---------|---------|------|
| `layer1_global.canvas_aspect_ratio` | `canvas.width` / `canvas.height` | 文本比例 → 具体像素 |
| `layer1_global.panel_count` | `elements` 数组长度 | 数字 → 实际元素 |
| `layer1_global.panel_arrangement` | 各 element 的 x/y 坐标 | 文本描述 → 坐标 |
| `layer2_regions[].position` | `elements[].x, y, width, height` | 文本 → 像素坐标 |
| `layer2_regions[].content_description` | `elements[].label.text` | 语义 → 具体文字 |
| `layer2_regions[].sub_elements` | `elements[].children[]` | 文本列表 → 形状数组 |
| `layer3_annotations[]` | `connections[]` | 抽象 → 具体连接 |
| `layer4_style.color_mapping` | 各 element 的 `fill` / `stroke` | 语义颜色 → #RRGGBB |

---

## 4. Claude Vision Enrichment

### 4.1 Enrichment Prompt

**文件**: `backend/app/core/prompts/enrichment_prompt.py`

```python
ENRICHMENT_SYSTEM_PROMPT = """你是学术图形布局引擎。你的任务是将语义级的图形描述（FigureSpec V1）
转换为包含精确像素坐标的几何描述（FigureSpec V2），同时参考提供的光栅原图。

## 输入
1. 一张学术论文配图的光栅图像（PNG）
2. FigureSpec V1 JSON（语义级描述）
3. 原始生成 Prompt

## 输出要求
输出严格遵循 FigureSpec V2 JSON schema，包含：

### canvas
- width 和 height 使用指定的画布尺寸

### elements（核心）
- 仔细观察原图中每个视觉模块的**位置、大小、形状、颜色**
- 为每个模块分配精确的 x, y, width, height（像素坐标）
- 识别模块的形状类型：rect | rounded_rect | circle | ellipse | diamond | parallelogram | trapezoid | hexagon | triangle | cylinder | cloud
- 提取每个模块的填充色（fill）和边框色（stroke），使用 #RRGGBB 格式
- 如果模块包含子元素，用 children 数组嵌套
- 每个可见的文字标注都应该有对应的 label

### connections（箭头/连接线）
- 识别所有箭头和连接线
- from_element / to_element 引用 elements 中的 id
- 选择正确的锚点（from_anchor / to_anchor）
- 识别连接类型：arrow | dashed_arrow | bidirectional | line | dashed_line
- 如果连接线有拐点，记录 waypoints

### text_blocks（独立文字）
- 不属于任何元素的独立文字（标题、脚注等）
- 精确位置和字号

### legends（图例）
- 如果有颜色图例，记录位置和各项颜色-标签对

## 坐标规则
- 所有坐标使用像素值，原点在左上角
- 元素间最小间距 20px
- 连接线不应穿过其他元素
- 文字大小根据元素大小自适应（通常 10-18px）
- 保持视觉层次：大模块包含小模块，标题在顶部

## 输出格式
仅输出 FigureSpec V2 JSON，不要包含 markdown 代码围栏或其他内容。
"""
```

### 4.2 API 调用逻辑

**复用**: `critique_tasks.py` 中的 `_resolve_api_key()` 函数（三级 BYOK 解析链）

```python
def _call_enrichment_api(
    image_bytes: bytes,
    figure_spec_v1: dict,
    active_prompt: str,
    canvas_width: int,
    canvas_height: int,
    api_key: str,
) -> dict:
    """调用 Claude Vision 将 FigureSpec V1 enrichment 为 V2。"""

    user_message = f"""请将以下 FigureSpec V1 转换为 V2，画布尺寸 {canvas_width}×{canvas_height}。

FigureSpec V1:
{json.dumps(figure_spec_v1, ensure_ascii=False, indent=2)}

原始 Prompt:
{active_prompt}
"""

    payload = {
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 8192,
        "system": ENRICHMENT_SYSTEM_PROMPT,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.b64encode(image_bytes).decode(),
                    },
                },
                {"type": "text", "text": user_message},
            ],
        }],
    }

    response = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        json=payload,
        timeout=60.0,
    )
    # 解析 JSON 响应 → FigureSpec V2 dict
```

### 4.3 V2 缓存策略

同一个 prompt 的 FigureSpec V2 可以缓存复用：

```python
# 导出时检查该 prompt 是否已有成功的 V2
existing = db.execute(
    text("""
        SELECT figure_spec_v2 FROM exports
        WHERE prompt_id = :pid AND figure_spec_v2 IS NOT NULL
          AND canvas_width = :w AND canvas_height = :h
        ORDER BY created_at DESC LIMIT 1
    """),
    {"pid": prompt_id, "w": canvas_width, "h": canvas_height}
).fetchone()

if existing:
    spec_v2 = existing[0]  # 复用，不调 Claude
else:
    spec_v2 = _call_enrichment_api(...)  # 调 Claude Vision
```

**效果**：同一 prompt 第一次导出 SVG 调 Claude，第二次导出 draw.io 直接复用 V2，零 API 成本。

---

## 5. SVG Exporter 实现

### 5.1 技术选型

使用 `svgwrite` 库（纯 Python SVG 生成，无 C 依赖）。

### 5.2 映射规则

**文件**: `backend/app/exporters/svg_exporter.py`

```python
class SVGExporter:
    def export(self, spec: FigureSpecV2) -> bytes:
        """将 FigureSpec V2 转换为 SVG bytes。"""
```

#### 元素映射

| V2 type | SVG 元素 | 说明 |
|---------|---------|------|
| `rect` | `<rect>` | 直接映射 |
| `rounded_rect` | `<rect rx="..." ry="...">` | corner_radius → rx/ry |
| `circle` | `<circle>` | width=height=diameter |
| `ellipse` | `<ellipse>` | rx=width/2, ry=height/2 |
| `diamond` | `<polygon points="...">` | 4 点菱形 |
| `parallelogram` | `<polygon points="...">` | 4 点平行四边形 |
| `trapezoid` | `<polygon points="...">` | 4 点梯形 |
| `hexagon` | `<polygon points="...">` | 6 点正六边形 |
| `triangle` | `<polygon points="...">` | 3 点三角形 |
| `cylinder` | `<path>` | 顶部椭圆 + 侧面 + 底部弧 |
| `cloud` | `<path>` | 贝塞尔曲线云形 |

#### SVG 结构

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 1600 900"
     width="1600" height="900">

  <!-- 背景 -->
  <rect width="100%" height="100%" fill="#FFFFFF"/>

  <!-- 元素层 -->
  <g id="elements">
    <g id="encoder_block">
      <rect x="100" y="200" width="300" height="400"
            rx="8" fill="#E8F4FD" stroke="#2196F3" stroke-width="2"/>
      <text x="250" y="220" text-anchor="middle"
            font-family="Helvetica" font-size="16" fill="#333">Encoder</text>

      <!-- 子元素 -->
      <g id="conv2d_layer">
        <rect x="120" y="260" width="260" height="50"
              fill="#BBDEFB" stroke="#1976D2" stroke-width="1"/>
        <text x="250" y="290" text-anchor="middle"
              font-family="Helvetica" font-size="12">Conv2D 3×3</text>
      </g>
    </g>
  </g>

  <!-- 连接层 -->
  <g id="connections">
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7"
              refX="10" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#666"/>
      </marker>
    </defs>
    <line x1="400" y1="400" x2="500" y2="400"
          stroke="#666" stroke-width="1.5" marker-end="url(#arrowhead)"/>
    <text x="450" y="390" text-anchor="middle" font-size="11">
      Feature Maps B×512×H×W
    </text>
  </g>

  <!-- 文字层 -->
  <g id="text-blocks">
    <text x="800" y="30" text-anchor="middle"
          font-size="18" font-weight="bold">
      Figure 1: ProposedNet Architecture
    </text>
  </g>

  <!-- 图例层 -->
  <g id="legends">
    <rect x="1300" y="800" width="16" height="16" fill="#E8F4FD"/>
    <text x="1322" y="813" font-size="11">Standard Module</text>
  </g>
</svg>
```

#### 关键实现细节

**箭头渲染**：
- 使用 SVG `<marker>` 定义箭头样式
- `arrow` → 实线 + 尾部箭头
- `dashed_arrow` → 虚线 (stroke-dasharray) + 箭头
- `bidirectional` → 两端都有 marker
- `line` / `dashed_line` → 无 marker

**Label 定位算法**：
```python
def _compute_label_position(element, label):
    cx = element.x + element.width / 2
    if label.position == "center":
        return cx, element.y + element.height / 2
    elif label.position == "top":
        return cx, element.y - 5  # 上方 5px
    elif label.position == "bottom":
        return cx, element.y + element.height + label.font_size + 5
```

**连接线路径**：
```python
def _build_connection_path(conn, elements_map):
    src = elements_map[conn.from_element]
    dst = elements_map[conn.to_element]
    start = _anchor_point(src, conn.from_anchor)
    end = _anchor_point(dst, conn.to_anchor)

    if conn.waypoints:
        points = [start] + [tuple(wp) for wp in conn.waypoints] + [end]
        return "M " + " L ".join(f"{x},{y}" for x, y in points)
    else:
        return f"M {start[0]},{start[1]} L {end[0]},{end[1]}"
```

---

## 6. draw.io Exporter 实现

### 6.1 技术选型

纯 XML 模板生成，无第三方库。draw.io 使用 mxGraph XML 格式。

### 6.2 映射规则

**文件**: `backend/app/exporters/drawio_exporter.py`

```python
class DrawioExporter:
    def export(self, spec: FigureSpecV2) -> bytes:
        """将 FigureSpec V2 转换为 draw.io XML bytes。"""
```

#### draw.io 文件结构

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" type="device">
  <diagram name="Figure" id="figure-1">
    <mxGraphModel dx="1600" dy="900" grid="1" gridSize="10"
                  guides="1" tooltips="1" connect="1"
                  arrows="1" fold="1" page="1"
                  pageScale="1" pageWidth="1600" pageHeight="900">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>

        <!-- 元素 -->
        <mxCell id="encoder_block" value="Encoder"
                style="rounded=1;whiteSpace=wrap;fillColor=#E8F4FD;
                       strokeColor=#2196F3;strokeWidth=2;
                       fontSize=16;fontFamily=Helvetica;fontColor=#333333;"
                vertex="1" parent="1">
          <mxGeometry x="100" y="200" width="300" height="400" as="geometry"/>
        </mxCell>

        <!-- 子元素（parent 指向父元素） -->
        <mxCell id="conv2d_layer" value="Conv2D 3×3"
                style="rounded=0;whiteSpace=wrap;fillColor=#BBDEFB;
                       strokeColor=#1976D2;fontSize=12;"
                vertex="1" parent="encoder_block">
          <mxGeometry x="20" y="60" width="260" height="50" as="geometry"/>
        </mxCell>

        <!-- 连接线 -->
        <mxCell id="conn_enc_dec" value="Feature Maps B×512×H×W"
                style="edgeStyle=orthogonalEdgeStyle;rounded=0;
                       strokeColor=#666666;strokeWidth=1.5;
                       fontSize=11;endArrow=block;endFill=1;"
                edge="1" source="encoder_block" target="decoder_block" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

#### V2 type → draw.io style 映射

| V2 type | draw.io style 片段 |
|---------|-------------------|
| `rect` | `shape=mxgraph.basic.rect;` |
| `rounded_rect` | `rounded=1;arcSize=...;` |
| `circle` | `ellipse;aspect=fixed;` |
| `ellipse` | `ellipse;` |
| `diamond` | `rhombus;` |
| `parallelogram` | `shape=parallelogram;` |
| `trapezoid` | `shape=trapezoid;` |
| `hexagon` | `shape=hexagon;` |
| `triangle` | `triangle;` |
| `cylinder` | `shape=cylinder3;` |
| `cloud` | `shape=cloud;` |

#### V2 连接类型 → draw.io style

| V2 type | draw.io style |
|---------|---------------|
| `arrow` | `endArrow=block;endFill=1;` |
| `dashed_arrow` | `endArrow=block;endFill=1;dashed=1;` |
| `bidirectional` | `endArrow=block;startArrow=block;endFill=1;startFill=1;` |
| `line` | `endArrow=none;` |
| `dashed_line` | `endArrow=none;dashed=1;` |

#### 子元素处理

draw.io 通过 `parent` 属性实现容器嵌套。子元素的 `parent` 设为父元素 ID，坐标变为相对于父元素：

```python
def _element_to_cell(self, element, parent_id="1", offset_x=0, offset_y=0):
    # 子元素坐标相对于父元素
    rel_x = element.x - offset_x
    rel_y = element.y - offset_y

    cell = self._create_cell(
        id=element.id,
        value=element.label.text if element.label else "",
        style=self._build_style(element),
        parent=parent_id,
        geometry=(rel_x, rel_y, element.width, element.height),
    )

    # 递归处理子元素
    for child in element.children:
        self._element_to_cell(child, parent_id=element.id,
                              offset_x=element.x, offset_y=element.y)
```

---

## 7. API 实现

### 7.1 Endpoints

**文件**: `backend/app/api/v1/exports.py`

```python
router = APIRouter(prefix="", tags=["Exports"])

@router.post("/images/{image_id}/export", response_model=ExportResponse, status_code=202)
async def export_from_image(image_id: UUID, data: ExportRequest, ...):
    """从已生成的光栅图导出可编辑格式。"""
    # 1. 验证 image 存在且属于当前用户
    # 2. 获取关联的 prompt（for FigureSpec V1）
    # 3. 创建 Export 记录
    # 4. dispatch Celery task
    # 5. 返回 export_id + task_id

@router.post("/prompts/{prompt_id}/export", response_model=ExportResponse, status_code=202)
async def export_from_prompt(prompt_id: UUID, data: ExportRequest, ...):
    """从 prompt 直接导出（无需光栅图）。"""
    # 1. 验证 prompt 存在
    # 2. 查找关联的最新 image（可选）
    # 3. 创建 Export 记录
    # 4. dispatch Celery task

@router.get("/exports/{export_id}", response_model=ExportResponse)
async def get_export(export_id: UUID, ...):
    """查询导出状态。"""

@router.get("/exports/{export_id}/download")
async def download_export(export_id: UUID, ...):
    """下载导出文件（StreamingResponse）。"""
    # 复用 images.py 中的下载模式

@router.get("/prompts/{prompt_id}/exports", response_model=list[ExportResponse])
async def list_prompt_exports(prompt_id: UUID, ...):
    """列出某 prompt 的所有导出记录。"""
```

### 7.2 Pydantic Schemas

**文件**: `backend/app/schemas/export.py`

```python
class ExportRequest(BaseModel):
    format: str  # "svg" | "drawio"
    canvas_width: int = 1600
    canvas_height: int | None = None

class ExportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    image_id: UUID | None
    prompt_id: UUID
    format: str
    canvas_width: int
    canvas_height: int
    export_status: str
    export_task_id: str | None
    storage_path: str | None
    download_url: str | None
    file_size_bytes: int | None
    export_duration_ms: int | None
    export_error: str | None
    created_at: datetime

class ExportStatusResponse(BaseModel):
    id: UUID
    export_status: str
    export_task_id: str | None
    export_error: str | None
```

---

## 8. Celery Task 实现

### 8.1 Task 签名

**文件**: `backend/app/tasks/export_tasks.py`

```python
@celery_app.task(
    name="app.tasks.export_tasks.export_figure_task",
    bind=True,
    max_retries=2,
    default_retry_delay=10,
    soft_time_limit=120,
    time_limit=150,
    queue="exports",
)
def export_figure_task(
    self: Task,
    export_id: str,
    prompt_id: str,
    image_id: str | None,
    user_id: str,
    format: str,          # "svg" | "drawio"
    canvas_width: int,
    canvas_height: int,
) -> dict:
    """导出 FigureSpec 为可编辑格式。"""
```

### 8.2 核心流程伪代码

```python
def export_figure_task(self, export_id, prompt_id, image_id, user_id,
                       format, canvas_width, canvas_height):
    db = _get_session()
    try:
        # 1. 标记 processing
        db.execute(text("UPDATE exports SET export_status='processing' WHERE id=:id"),
                   {"id": export_id})
        db.commit()

        # 2. 加载数据
        prompt = db.execute(text("SELECT figure_spec, active_prompt, suggested_figure_type "
                                 "FROM prompts WHERE id=:id"), {"id": prompt_id}).fetchone()

        image_bytes = None
        if image_id:
            image = db.execute(text("SELECT storage_path FROM images WHERE id=:id"),
                               {"id": image_id}).fetchone()
            if image and image.storage_path:
                storage = StorageService()
                image_bytes = storage.download_file(image.storage_path)

        # 3. 获取或生成 FigureSpec V2
        spec_v2 = _get_or_create_v2(db, prompt_id, prompt, image_bytes,
                                     canvas_width, canvas_height, user_id)

        # 4. 调用 exporter
        if format == "svg":
            exporter = SVGExporter()
            content_type = "image/svg+xml"
            ext = "svg"
        elif format == "drawio":
            exporter = DrawioExporter()
            content_type = "application/xml"
            ext = "drawio"

        file_bytes = exporter.export(FigureSpecV2(**spec_v2))

        # 5. 上传 MinIO
        storage = StorageService()
        object_name = f"exports/{user_id}/{export_id}.{ext}"
        storage.upload_file(file_bytes, object_name, content_type)

        # 6. 更新记录
        db.execute(text("""
            UPDATE exports
            SET export_status='completed', storage_path=:path,
                file_size_bytes=:size, figure_spec_v2=:v2,
                export_duration_ms=:dur, updated_at=now()
            WHERE id=:id
        """), {
            "id": export_id, "path": object_name,
            "size": len(file_bytes), "v2": json.dumps(spec_v2),
            "dur": duration_ms
        })
        db.commit()

        return {"export_id": export_id, "status": "completed", "format": format}

    except Exception as exc:
        db.execute(text("UPDATE exports SET export_status='failed', "
                        "export_error=:err WHERE id=:id"),
                   {"id": export_id, "err": str(exc)})
        db.commit()
        raise
    finally:
        db.close()
```

---

## 9. 前端实现

### 9.1 ExportButtonGroup 组件

**文件**: `frontend/src/components/ExportButtonGroup.tsx`

```typescript
interface ExportButtonGroupProps {
  imageId?: string;
  promptId: string;
  disabled?: boolean;
}

// 功能：
// - 两个按钮：SVG 图标按钮 + draw.io 图标按钮
// - 点击后 POST /images/{id}/export 或 /prompts/{id}/export
// - 显示 loading spinner
// - 轮询 GET /exports/{id} 直到 completed/failed
// - completed → fetchAuthedBlob + triggerBrowserDownload
// - failed → toast 错误提示
```

### 9.2 集成位置

**ProjectWorkspace.tsx**:
- 每个 image 卡片的操作栏增加 `<ExportButtonGroup>`
- 位于现有下载按钮旁边

**Generate.tsx**:
- 生成结果区域增加导出入口

---

## 10. Celery 配置

### celery_app.py 变更

```python
# 新增 include
include = [..., "app.tasks.export_tasks"]

# 新增 queue
task_routes = {
    ...,
    "app.tasks.export_tasks.*": {"queue": "exports"},
}
```

---

## 11. 文件清单

### 新建文件（12 个）

| 文件路径 | 用途 |
|---------|------|
| `backend/app/models/export.py` | Export SQLAlchemy model |
| `backend/app/schemas/export.py` | Export Pydantic schemas |
| `backend/app/api/v1/exports.py` | Export API endpoints |
| `backend/app/tasks/export_tasks.py` | Celery export task |
| `backend/app/exporters/__init__.py` | Exporter package |
| `backend/app/exporters/base.py` | FigureSpec V2 schema + BaseExporter |
| `backend/app/exporters/svg_exporter.py` | SVG 导出器 |
| `backend/app/exporters/drawio_exporter.py` | draw.io 导出器 |
| `backend/app/core/prompts/enrichment_prompt.py` | V1→V2 enrichment prompt |
| `backend/alembic/versions/xxx_phase2_exports.py` | DB migration |
| `frontend/src/components/ExportButtonGroup.tsx` | 导出按钮组 |
| `frontend/src/components/ExportHistory.tsx` | 导出历史面板 |

### 修改文件（6 个）

| 文件路径 | 改动 |
|---------|------|
| `backend/app/models/__init__.py` | 注册 Export model |
| `backend/app/tasks/celery_app.py` | 注册 export_tasks + exports queue |
| `backend/app/main.py` | 注册 exports router |
| `backend/pyproject.toml` | 添加 svgwrite 依赖 |
| `frontend/src/pages/ProjectWorkspace.tsx` | 集成 ExportButtonGroup |
| `frontend/src/pages/Generate.tsx` | 集成导出入口 |

---

## 12. 实施计划

### Week 1 — 核心链路

| 序号 | 任务 | 产出 |
|------|------|------|
| 1 | DB migration (exports 表) | Alembic migration 文件 |
| 2 | FigureSpec V2 Pydantic schema | `exporters/base.py` |
| 3 | Export model + schema | `models/export.py` + `schemas/export.py` |
| 4 | Claude Vision enrichment prompt + 调用 | `enrichment_prompt.py` + `export_tasks.py` |
| 5 | SVG exporter | `svg_exporter.py` |
| 6 | draw.io exporter | `drawio_exporter.py` |
| 7 | Export API endpoints + MinIO 上传/下载 | `api/v1/exports.py` |

### Week 2 — 集成 + 测试

| 序号 | 任务 | 产出 |
|------|------|------|
| 8 | Celery 注册 + main.py router | 配置变更 |
| 9 | ExportButtonGroup 前端组件 | React 组件 |
| 10 | ProjectWorkspace + Generate 页面集成 | 页面改动 |
| 11 | 12 种图类型 × 2 种格式端到端测试 | 测试报告 |
| 12 | 错误处理 + V2 缓存 + 重试逻辑 | 健壮性完善 |

---

## 13. 测试计划

### 13.1 单元测试

| 测试项 | 覆盖范围 |
|--------|---------|
| V2 schema 校验 | 各种 V2 JSON 的 Pydantic parse |
| SVG exporter | 12 种元素类型 + 5 种连接类型 |
| draw.io exporter | 12 种元素类型 + 子元素嵌套 + 连接 |
| 锚点计算 | 8 种锚点位置的坐标计算 |

### 13.2 集成测试

| 测试项 | 方法 |
|--------|------|
| API 端点 | POST export → GET status → GET download |
| Celery task | Mock Claude Vision → 验证完整流程 |
| MinIO 上传/下载 | 验证文件存储和 presigned URL |

### 13.3 端到端测试

| 测试项 | 方法 |
|--------|------|
| 12 种图类型 × SVG | 每种类型导出 SVG，在 Inkscape 中验证可编辑性 |
| 12 种图类型 × draw.io | 每种类型导出 .drawio，在 draw.io 中验证可编辑性 |
| 无光栅图导出 | 仅有 prompt 时导出，验证 Claude Vision 仅基于 V1 生成 |
| V2 缓存 | 同一 prompt 导出两次，验证第二次不调 Claude |
| 错误恢复 | 模拟 Claude Vision 超时，验证 failed 状态 + 重试 |
