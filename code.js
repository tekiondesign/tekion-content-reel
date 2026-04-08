figma.showUI(__html__, { width: 380, height: 580 });

// ── Utility: load fonts safely (handles mixed fonts) ──
async function loadFonts(node) {
	try {
		await figma.loadFontAsync(node.fontName);
	} catch (e) {
		const len = node.characters.length || 1;
		for (let c = 0; c < len; c++) {
			await figma.loadFontAsync(node.getRangeFontName(c, c + 1));
		}
	}
}

// ── Utility: Fisher-Yates shuffle ──
function shuffle(arr) {
	const a = arr.slice();
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// ── Utility: check if a node supports image fills ──
function canHaveImageFill(node) {
	return (
		node.type === "RECTANGLE" ||
		node.type === "ELLIPSE" ||
		node.type === "POLYGON" ||
		node.type === "STAR" ||
		node.type === "VECTOR" ||
		node.type === "FRAME" ||
		node.type === "COMPONENT" ||
		node.type === "INSTANCE" ||
		node.type === "GROUP"
	);
}

figma.ui.onmessage = async (msg) => {
	// ── Apply shuffled texts from a field to selected text layers ──
	if (msg.type === "apply-random-text") {
		const sel = figma.currentPage.selection;
		const textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select one or more text layers first.");
			return;
		}
		const pool = shuffle(msg.values);
		let applied = 0;
		for (let i = 0; i < textNodes.length; i++) {
			await loadFonts(textNodes[i]);
			textNodes[i].characters = pool[i % pool.length];
			applied++;
		}
		figma.notify(`✓ Applied random text to ${applied} layer(s)`);
	}

	// ── Apply single clicked text ──
	if (msg.type === "apply-single-text") {
		const sel = figma.currentPage.selection;
		const textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select a text layer first.");
			return;
		}
		for (const node of textNodes) {
			await loadFonts(node);
			node.characters = msg.value;
		}
		figma.notify(`✓ Applied to ${textNodes.length} layer(s)`);
	}

	// ── Apply avatar image as fill to selected shapes/frames/auto-layout ──
	if (msg.type === "apply-avatar") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select a shape, frame, or auto-layout layer.");
			return;
		}

		try {
			// Download the image from the GitHub URL
			const resp = await fetch(msg.url);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const buffer = await resp.arrayBuffer();
			const imgBytes = new Uint8Array(buffer);

			// Create an image in Figma from the raw bytes
			const image = figma.createImage(imgBytes);

			let applied = 0;
			for (const node of sel) {
				if (canHaveImageFill(node) && "fills" in node) {
					// Replace all fills with the avatar image fill
					node.fills = [
						{
							type: "IMAGE",
							scaleMode: "FILL",
							imageHash: image.hash,
						},
					];
					applied++;
				}
			}

			if (applied === 0) {
				figma.notify("⚠ Select shapes, frames, or auto-layout containers.");
			} else {
				figma.notify(`✓ Applied avatar to ${applied} layer(s)`);
			}
		} catch (e) {
			console.error("Avatar load error:", e);
			figma.notify("⚠ Failed to load avatar: " + e.message);
		}
	}

	// ── Shuffle avatars: apply random avatars from a list to selected shapes ──
	if (msg.type === "apply-random-avatars") {
		const sel = figma.currentPage.selection;
		const fillable = sel.filter((n) => canHaveImageFill(n) && "fills" in n);
		if (fillable.length === 0) {
			figma.notify("⚠ Select shapes or frames for avatar fills.");
			return;
		}

		const urls = shuffle(msg.urls);
		let applied = 0;

		for (let i = 0; i < fillable.length; i++) {
			const url = urls[i % urls.length];
			try {
				const resp = await fetch(url);
				if (!resp.ok) continue;
				const buffer = await resp.arrayBuffer();
				const image = figma.createImage(new Uint8Array(buffer));
				fillable[i].fills = [
					{
						type: "IMAGE",
						scaleMode: "FILL",
						imageHash: image.hash,
					},
				];
				applied++;
			} catch (e) {
				console.error("Failed to load:", url, e);
			}
		}
		figma.notify(`✓ Applied ${applied} avatar(s) to selection`);
	}

	// ── Apply SVG icon into selected frames/shapes ──
	if (msg.type === "apply-icon") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select one or more frames or shapes.");
			return;
		}
		let iconNode;
		try {
			iconNode = figma.createNodeFromSvg(msg.svg);
		} catch (e) {
			figma.notify("⚠ Failed to parse icon SVG.");
			return;
		}
		let applied = 0;
		for (const node of sel) {
			if ("appendChild" in node) {
				const clone = iconNode.clone();
				const scale =
					Math.min(node.width / clone.width, node.height / clone.height) * 0.55;
				clone.rescale(scale);
				clone.x = (node.width - clone.width) / 2;
				clone.y = (node.height - clone.height) / 2;
				node.appendChild(clone);
				applied++;
			}
		}
		iconNode.remove();
		figma.notify(
			applied
				? `✓ Placed icon in ${applied} layer(s)`
				: "⚠ Select frames or components.",
		);
	}
};
