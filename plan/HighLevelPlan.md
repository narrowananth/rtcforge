# 🚀 RTCForge

> **Build real-time applications without reinventing infrastructure**
>
> *Forge your own real-time infrastructure.*

---

## 🧩 Overview

**RTCForge** is an open-source, developer-first **low-level real-time communication framework** built on WebRTC.

It provides a unified foundation to build:

* 🎥 Video & Voice applications
* 📡 Interactive live streaming platforms
* 🧑‍🤝‍🧑 Collaboration tools (whiteboard, chat)
* 📺 Broadcast & recording systems

👉 RTCForge eliminates the complexity of building real-time infrastructure from scratch, allowing developers to focus on product innovation.

---

## 🏗️ Infrastructure Model

RTCForge is **infrastructure-agnostic**.

👉 It does NOT provide hosted services.

Instead, developers bring their own infrastructure:

* STUN/TURN servers (coturn)
* Redis (state & presence)
* Messaging system (NATS/Kafka)
* Storage (S3/MinIO)

RTCForge connects to these services via configuration.

> This gives full control, scalability, and avoids vendor lock-in.

---

## ⚖️ Responsibility Model

### ✅ RTCForge Provides

* Signaling server
* SFU integration (mediasoup)
* SDKs (JS, Java)
* APIs & protocols
* Developer tooling

### 👤 You Provide

* Infrastructure (TURN, Redis, Storage, etc.)
* Deployment (Docker/Kubernetes)
* Scaling & monitoring

---

## 🎯 Vision

> “To become the open standard for building real-time communication systems.”

---

## 💡 Why RTCForge?

* 🔓 Open-source & self-hosted
* 🚫 No vendor lock-in
* ⚡ Built on WebRTC (low latency)
* 🧱 Modular & extensible
* 🧑‍💻 Developer-first API design
* 🏢 Enterprise-ready architecture

---

## ⚡ Quick Start (Coming Soon)

```bash
git clone https://github.com/your-org/rtcforge
cd rtcforge
docker-compose up
```

> Full setup guide: [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) *(coming soon)*

---

## 🧠 Architecture Philosophy

> **“SFU for media, WebSockets for data.”**

RTCForge is built using a **Selective Forwarding Unit (SFU)** architecture powered by mediasoup.

---

## 🧩 Features

### 🎥 Media Communication

* 1:1 and Group Video Calls
* Voice Calls
* Screen Sharing
* Adaptive Bitrate Streaming

---

### 📡 Streaming

* Interactive Live Streaming (WebRTC-based)
* Broadcast Streaming (WebRTC → HLS/RTMP)
* Multi-host streaming

---

### 🔌 Signaling Layer

* WebSocket-based signaling
* Room & session management
* Peer discovery
* Connection lifecycle handling

---

### 💬 Messaging

* Real-time chat (1:1 & group)
* Presence (online/offline)
* Typing indicators

---

### 🧑‍🎨 Collaboration

* Interactive whiteboard support
* State synchronization
* Event broadcasting

---

### 🎥 Recording

* Server-side recording
* Stream-based or composite recording
* Cloud storage integration

---

### 🧑‍💻 Developer Experience

* JavaScript SDK (npm)
* REST APIs
* WebSocket APIs
* Plugin-based architecture

---

### ⚙️ Integration Modes

* SDK-based integration
* API-based backend integration
* Low-code components *(future)*
* No-code builder *(future)*

---

## 🏛️ High-Level Architecture

```
Client (Web / Mobile / Desktop)
        ↓
SDK Layer (JS)
        ↓
API Gateway (REST + Auth)
        ↓
Signaling Server (WebSocket)
        ↓
Media Server (SFU - mediasoup)
        ↓
Services Layer
   ├── Chat Service
   ├── Recording Service
   ├── Streaming Service
   ├── Whiteboard Sync Service
        ↓
Messaging Backbone (Kafka / NATS)
        ↓
Storage (S3 / MinIO)
        ↓
STUN/TURN (coturn)
```

> ⚠️ Note: Infrastructure components (TURN, Redis, Storage, Messaging) are **externally managed by the user**, not bundled inside RTCForge.

---

## ⚔️ Media Architecture Choices

RTCForge supports multiple communication patterns:

| Architecture | Usage                               |
| ------------ | ----------------------------------- |
| Mesh         | 1:1 calls (optional optimization)   |
| MCU          | Recording/composition (limited use) |
| SFU          | ✅ Core architecture (recommended)   |

👉 **SFU is the default and primary architecture** for scalability and performance.

---

## 🧭 Feature → Architecture Mapping

| Feature                    | Architecture |
| -------------------------- | ------------ |
| 1:1 Video Call             | Mesh / SFU   |
| Group Video Call           | SFU          |
| Voice Chat                 | SFU          |
| Interactive Live Streaming | SFU          |
| Broadcast Streaming        | SFU + HLS    |
| Whiteboard                 | WebSocket    |
| Chat                       | WebSocket    |
| Recording                  | SFU + Worker |
| Screen Sharing             | SFU          |

---

## ⚙️ Tech Stack

### Backend

* Node.js (Signaling, APIs, optional services)

### Media Layer

* WebRTC
* mediasoup

### Messaging

* WebSockets
* Kafka / NATS

### Storage

* S3 / MinIO

### Infrastructure

* STUN/TURN (coturn)
* Docker
* Kubernetes *(future)*

---

## 📦 Project Structure

```
rtcforge/
 ├── server/
 │    ├── signaling/
 │    ├── media/
 │
 ├── sdk/
 │    ├── js/
 │
 ├── services/
 │    ├── chat/
 │    ├── recording/
 │    ├── streaming/
 │    ├── whiteboard/
 │
 ├── examples/
 │    ├── video-call-app/
 │
 ├── docs/
 ├── docker/
 └── cli/
```

---

## 🚀 Roadmap

### 🟢 Phase 1 — Foundation (MVP)

* Signaling server (Node.js)
* 1:1 video call
* Room management
* Basic JS SDK

---

### 🟡 Phase 2 — SFU Integration

* Integrate mediasoup
* Group video calls
* Media routing

---

### 🟠 Phase 3 — Core Platform

* Chat system
* Presence
* Recording
* REST APIs

---

### 🔵 Phase 4 — Streaming

* Live streaming
* Host/audience roles
* WebRTC → HLS pipeline

---

### 🟣 Phase 5 — Collaboration

* Whiteboard integration
* Sync engine
* Event system

---

### 🔴 Phase 6 — Ecosystem

* Plugin system
* CLI tools
* Documentation site
* Sample apps

---

### ⚫ Phase 7 — Low-Code / No-Code

* UI builder
* Drag & drop components
* Templates

---

## 🎯 Target Use Cases

* Video conferencing platforms
* Live streaming applications
* EdTech platforms
* Telemedicine systems
* Real-time collaboration tools

---

## 🔓 Open Source Strategy

* Core framework → Open Source (MIT/Apache)
* Plugins → Community-driven
* Hosted platform → Future monetization

---

## ⚠️ Key Design Principles

* Keep the core minimal
* Build modular services
* Prefer event-driven architecture
* Focus on developer experience
* Scale horizontally

---

## 🏁 Final Thought

> RTCForge is not just a library — it is a **foundation for building real-time systems**.

---

## 🤝 Contributing

Contributions are welcome!
Please read `CONTRIBUTING.md` before submitting PRs.

---

## 📄 License

MIT License (or Apache 2.0)

---
