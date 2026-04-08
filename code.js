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
			const node = textNodes[i];
			await loadFonts(node);
			node.characters = pool[i % pool.length];
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

	// ── Apply avatar image as fill to selected shapes ──
	if (msg.type === "apply-avatar") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select a shape layer first.");
			return;
		}
		try {
			const imgBytes = await figma.createImageAsync(msg.url);
			let applied = 0;
			for (const node of sel) {
				if ("fills" in node) {
					node.fills = [
						{
							type: "IMAGE",
							scaleMode: "FILL",
							imageHash: imgBytes.hash,
						},
					];
					applied++;
				}
			}
			figma.notify(`✓ Applied avatar to ${applied} layer(s)`);
		} catch (e) {
			figma.notify("⚠ Failed to load avatar image.");
		}
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

	// ── Apply a complete record (name → text, avatar → image fills) ──
	if (msg.type === "apply-record") {
		const sel = figma.currentPage.selection;
		if (sel.length === 0) {
			figma.notify("⚠ Select layers first.");
			return;
		}
		// Apply text to all text layers
		const textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length > 0 && msg.value) {
			for (const node of textNodes) {
				await loadFonts(node);
				node.characters = msg.value;
			}
		}
		figma.notify(`✓ Applied record data`);
	}
};
