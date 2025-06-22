
# koad\:io-dark-passenger

`dark-passenger` is the Chrome extension component of the **koad\:io ecosystem**. It allows your browser to directly communicate with your local daemon (`~/.koad-io/daemon`) via DDP — enabling real-time entity-driven automations, authenticated actions, and local-first data capture into your kingdom’s database.

---

## 👑 Digital Kingdoms, Meet the Web

In the world of koad\:io, your **kingdom** is a local, sovereign space — a secure environment where your data, keys, and automations live. Inside your kingdom are **entities**, each designed to accomplish focused goals: research, auth, scheduling, scraping, automation, memory. These entities live on disk (e.g. `~/.alice`) and communicate with one another via Meteor DDP and shared MongoDB instances.

`dark-passenger` lets these entities travel with you as you browse the web — observing, responding, and acting as needed. You decide which entity you bring along for the ride.

---

## ✨ Features

* **Local-first**: All data flows locally, between the browser and your daemon — no cloud, no leaks.
* **Entity-powered automations**: Use `~/.alice` or other entities to watch, react, or log your activity on any webpage.
* **DDP-connected**: Real-time, reactive communication between your browser and the daemon.
* **Cross-website workflows**: Carry memory and context across browsing sessions — browser state becomes persistent and actionable.
* **Sovereign identity**: Sign or push assertions through your local keys — usable for auth, protocol assertions, or cryptographic workflows.

---

## 📦 Structure

* `~/.koad-io/passenger/` — The Chrome extension.
* `~/.koad-io/daemon/` — The local Meteor server it talks to.
* `~/.koad-io/id/` — Your entity trust store (public keys only).
* `~/.alice/` — An example entity, with keys and MongoDB for persistent local state.

---

## 🔧 Getting Started

1. Setup your local daemon:

   ```bash
   koad-io setup daemon
   ```

2. In Chrome, open `chrome://extensions`, enable *Developer Mode*, then click *Load unpacked* and select `~/.koad-io/passenger`.

3. The extension auto-connects to `$KOAD_IO_BIND_IP:9568` and begins syncing with your entities.

---

## 📚 Use Cases

* **Auth**: Use your entity to sign or verify data from websites.
* **Automation**: Watch a site and trigger scripts or emit events when things change.
* **Data capture**: Save DOM elements, forms, text, etc., into your entity's MongoDB.
* **Project or personal workflows**: Define entity behavior for specific web domains.

---

## 🤝 Contributing

Ideas, enhancements, bug reports, and new entity concepts are always welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## 🛡 License

MIT — see [LICENSE](LICENSE).

---

## 🔗 Learn More

* [koad\:io repository](https://github.com/koad/io)
* [`~/.koad-io/daemon`](../daemon) — Meteor DDP server.
* [`~/.alice`](https://github.com/koad/alice) — Example entity with automation logic.
* [`~/.koad-io/id`](../id) — Public key trust structure for your entities.

> Your browser is no longer just a client — it’s a stage for your kingdom to act upon.
> — *The dark-passenger rides with you.*

