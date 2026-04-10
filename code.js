figma.showUI(__html__, { width: 380, height: 580 });

async function loadFonts(node) {
	try {
		await figma.loadFontAsync(node.fontName);
	} catch (e) {
		var len = node.characters.length || 1;
		for (var c = 0; c < len; c++) {
			await figma.loadFontAsync(node.getRangeFontName(c, c + 1));
		}
	}
}

function shuffle(arr) {
	var a = arr.slice();
	for (var i = a.length - 1; i > 0; i--) {
		var j = Math.floor(Math.random() * (i + 1));
		var t = a[i];
		a[i] = a[j];
		a[j] = t;
	}
	return a;
}

function canHaveImageFill(node) {
	return "fills" in node && node.type !== "TEXT" && node.type !== "GROUP";
}

// Recursively clear fills on frame/group nodes that act as SVG wrappers,
// and remove any invisible bounding-box rectangles (256x256 with no visible paint)
function cleanSvgFrame(frame) {
	if ("fills" in frame && frame.type !== "TEXT") {
		frame.fills = [];
	}
	if ("children" in frame) {
		for (var i = frame.children.length - 1; i >= 0; i--) {
			var child = frame.children[i];
			// Remove invisible background rects (common in Phosphor raw SVGs)
			if (
				child.type === "RECTANGLE" &&
				child.width >= 250 &&
				child.height >= 250 &&
				child.visible !== false
			) {
				var hasFill = false;
				if ("fills" in child) {
					var fills = child.fills;
					for (var f = 0; f < fills.length; f++) {
						if (fills[f].visible !== false && fills[f].opacity !== 0) {
							// Check if it's a "none" fill (transparent) — skip those
							if (fills[f].type === "SOLID" && fills[f].color) {
								// Could be a background — remove if fully white or black with no opacity
								hasFill = true;
							}
						}
					}
				}
				// If it has no stroke and looks like a bounding box rect, remove it
				var hasStroke = false;
				if ("strokes" in child) {
					for (var s = 0; s < child.strokes.length; s++) {
						if (child.strokes[s].visible !== false) hasStroke = true;
					}
				}
				if (!hasStroke) {
					// Remove background rects — they're just bounding boxes
					child.remove();
					continue;
				}
			}
			// Recurse into child frames/groups
			if ("children" in child) {
				cleanSvgFrame(child);
			}
		}
	}
}

figma.ui.onmessage = async (msg) => {
	if (msg.type === "apply-random-text") {
		var sel = figma.currentPage.selection;
		var textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select text layers.");
			return;
		}
		var pool = shuffle(msg.values);
		for (var i = 0; i < textNodes.length; i++) {
			await loadFonts(textNodes[i]);
			textNodes[i].characters = pool[i % pool.length];
		}
		figma.notify("✓ Applied to " + textNodes.length + " layer(s)");
	}

	if (msg.type === "apply-single-text") {
		var sel = figma.currentPage.selection;
		var textNodes = sel.filter((n) => n.type === "TEXT");
		if (textNodes.length === 0) {
			figma.notify("⚠ Select a text layer.");
			return;
		}
		for (var node of textNodes) {
			await loadFonts(node);
			node.characters = msg.value;
		}
		figma.notify("✓ Applied to " + textNodes.length + " layer(s)");
	}

	if (msg.type === "apply-avatar-bytes") {
		var sel = figma.currentPage.selection;
		var fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify("⚠ Select shapes or frames.");
			return;
		}
		try {
			var image = figma.createImage(new Uint8Array(msg.bytes));
			for (var node of fillable) {
				node.fills = [
					{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
				];
			}
			figma.notify("✓ Applied avatar to " + fillable.length + " layer(s)");
		} catch (e) {
			figma.notify("⚠ Failed to apply avatar.");
		}
	}

	if (msg.type === "apply-random-avatar-bytes") {
		var sel = figma.currentPage.selection;
		var fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify("⚠ Select shapes or frames.");
			return;
		}
		var applied = 0;
		for (var i = 0; i < fillable.length; i++) {
			var imgData = msg.bytesArray[i % msg.bytesArray.length];
			if (!imgData) continue;
			try {
				var image = figma.createImage(new Uint8Array(imgData));
				fillable[i].fills = [
					{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
				];
				applied++;
			} catch (e) {}
		}
		figma.notify("✓ Applied " + applied + " avatar(s)");
	}

	if (msg.type === "apply-avatar-fallback") {
		var sel = figma.currentPage.selection;
		var fillable = sel.filter((n) => canHaveImageFill(n));
		if (fillable.length === 0) {
			figma.notify("⚠ No fillable layers.");
			return;
		}
		try {
			var image = await figma.createImageAsync(msg.url);
			for (var node of fillable) {
				node.fills = [
					{ type: "IMAGE", scaleMode: "FILL", imageHash: image.hash },
				];
			}
			figma.notify("✓ Applied avatar to " + fillable.length + " layer(s)");
		} catch (e) {
			figma.notify("⚠ Could not load image.");
		}
	}

	// ── Apply icon: replace into selection OR place on canvas ──
	if (msg.type === "apply-icon") {
		var sel = figma.currentPage.selection;
		var svgStr = msg.svg;
		var iconName = msg.name || "Icon";

		// Nothing selected → place editable icon on canvas at viewport center
		if (sel.length === 0) {
			var svgFrame;
			try {
				svgFrame = figma.createNodeFromSvg(svgStr);
			} catch (e) {
				figma.notify("⚠ Bad SVG.");
				return;
			}

			// Keep as a frame — this IS the bounding box
			svgFrame.name = iconName;

			// Clean the SVG frame: remove fills and background rects
			cleanSvgFrame(svgFrame);

			// Scale to 24x24 (standard icon size)
			var size = 24;
			var scaleF = size / Math.max(svgFrame.width, svgFrame.height);
			svgFrame.resize(svgFrame.width * scaleF, svgFrame.height * scaleF);

			// Position at center of viewport
			var vCenter = figma.viewport.center;
			svgFrame.x = Math.round(vCenter.x - svgFrame.width / 2);
			svgFrame.y = Math.round(vCenter.y - svgFrame.height / 2);

			// Make the frame act as a proper icon container
			svgFrame.clipsContent = true;
			svgFrame.fills = [];
			svgFrame.layoutMode = "NONE";
			svgFrame.constraints = { horizontal: "SCALE", vertical: "SCALE" };

			figma.currentPage.selection = [svgFrame];
			figma.viewport.scrollAndZoomIntoView([svgFrame]);
			figma.notify("✓ Placed " + iconName + " on canvas");
			return;
		}

		// Selection exists → replace into each selected node
		var applied = 0;
		for (var node of sel) {
			var targetW = node.width;
			var targetH = node.height;

			// Container nodes (frame, component, group) → clear & insert
			if ("children" in node && node.type !== "TEXT") {
				// Remove ALL existing children
				while (node.children.length > 0) {
					node.children[0].remove();
				}

				// Rename the container to the new icon name
				node.name = iconName;

				var svgFrame;
				try {
					svgFrame = figma.createNodeFromSvg(svgStr);
				} catch (e) {
					continue;
				}

				// Clean the SVG frame
				cleanSvgFrame(svgFrame);

				// Move each vector child from the SVG frame into the target container
				// Scale them to fit the target size
				var svgW = svgFrame.width;
				var svgH = svgFrame.height;
				var scale = Math.min(targetW / svgW, targetH / svgH);
				var offsetX = (targetW - svgW * scale) / 2;
				var offsetY = (targetH - svgH * scale) / 2;

				while (svgFrame.children.length > 0) {
					var child = svgFrame.children[0];
					// Store original position before reparenting
					var origX = child.x;
					var origY = child.y;
					var origW = child.width;
					var origH = child.height;
					node.appendChild(child);
					// Scale and reposition the child
					child.x = origX * scale + offsetX;
					child.y = origY * scale + offsetY;
					child.resize(origW * scale, origH * scale);
				}
				svgFrame.remove();

				// Clear fills on the container too
				if ("fills" in node) {
					node.fills = [];
				}

				applied++;
			}
			// Simple shapes → place icon frame on top matching size
			else if (node.type !== "TEXT") {
				var svgFrame;
				try {
					svgFrame = figma.createNodeFromSvg(svgStr);
				} catch (e) {
					continue;
				}

				// Clean the SVG frame
				cleanSvgFrame(svgFrame);

				svgFrame.name = iconName;
				svgFrame.fills = [];
				svgFrame.clipsContent = true;

				// Resize the SVG frame to match the target shape
				svgFrame.resize(targetW, targetH);

				// Position over the shape
				var absX = node.absoluteTransform[0][2];
				var absY = node.absoluteTransform[1][2];
				svgFrame.x = absX;
				svgFrame.y = absY;

				if (node.parent) {
					var idx = node.parent.children.indexOf(node);
					node.parent.insertChild(idx + 1, svgFrame);
				} else {
					figma.currentPage.appendChild(svgFrame);
				}
				applied++;
			}
		}

		if (applied > 0) {
			figma.notify("✓ Replaced icon in " + applied + " layer(s)");
		} else {
			figma.notify("⚠ Select frames or shapes.");
		}
	}
};
