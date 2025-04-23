The RTP Stack:-

-   ICE: Interactive Connectivity Establishment
-   STUN: Session Traversal Utilities for Network Address Translation (NAT)
-   TURN: Traversal Using Relays around NAT
-   SDP: Session Description Protocol
-   DTLS: Datagram Transport Layer Security
-   SCTP: Stream Control Transport Protocol
-   SRTP: Secure Real-Time Transport Protocol

-   ICE, STUN, and TURN are necessary to establish and maintain a peer-to-peer connection over UDP.
-   DTLS is used to secure all data transfers between peers; encryption is a mandatory feature of WebRTC.
-   SCTP and SRTP are the application protocols used to multiplex the different streams, provide congestion and flow control, and provide partially reliable delivery and other additional services on top of UDP.
-   Session Description Protocol (SDP) is a data format used to negotiate the parameters of the peer-to-peer connection. However, the SDP “offer” and “answer” are communicated out of band, which is why SDP is missing from the protocol diagram.

ref link - https://princiya777.wordpress.com/category/webrtc/
