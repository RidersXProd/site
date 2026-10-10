// --- 1. CONFIGURATION FIREBASE ---
// TODO: Remplacez ces valeurs par celles de votre projet Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAuUI5XcdORkueTIOcnWOTGmlFsrNR8HnA",
  authDomain: "prods-3c7be.firebaseapp.com",
  projectId: "prods-3c7be",
  storageBucket: "prods-3c7be.firebasestorage.app",
  messagingSenderId: "569828883271",
  appId: "1:569828883271:web:b107d1267ccba64a6c6a62",
  measurementId: "G-50PVM63SPW"
};

// Initialisation de Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const storage = firebase.storage();

// --- 2. VARIABLES GLOBALES ---
const ADMIN_PASSWORD = "admin"; 
let isAdmin = false;

let tracks = [];
let categories = [];
let activeFilter = "Tous";
let currentAudio = null;

// --- 3. ÉLÉMENTS DU DOM ---
const btnAdminToggle = document.getElementById('btn-admin-toggle');
const dragOverlay = document.getElementById('drag-overlay');
const tracksContainer = document.getElementById('tracks-container');
const categoryListDOM = document.getElementById('category-list');
const checkboxContainer = document.getElementById('checkbox-container');
const importModal = document.getElementById('import-modal');
const importForm = document.getElementById('import-form');
const titleInput = document.getElementById('track-title');
const fileInput = document.getElementById('audio-file');
const newCategoryInput = document.getElementById('new-category');
const btnOpenImport = document.getElementById('btn-open-import');
const btnCloseModal = document.getElementById('btn-close-modal');

// --- 4. SYNCHRONISATION EN TEMPS RÉEL (FIRESTORE) ---

// Écoute les modifications des catégories en direct
db.collection('settings').doc('metadata').onSnapshot(doc => {
    if (doc.exists) {
        categories = doc.data().categories || [];
    } else {
        // Initialisation de base si la base de données est vide
        categories = ["Hoodtrap", "Jersey Drill", "Rap Français", "Orchestral", "Balkan"];
        db.collection('settings').doc('metadata').set({ categories: categories });
    }
    updateAllUIs();
});

// Écoute l'ajout/suppression de prods en direct
db.collection('tracks').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
    tracks = [];
    snapshot.forEach(doc => {
        tracks.push({ id: doc.id, ...doc.data() });
    });
    updateAllUIs();
});

function updateAllUIs() {
    categories.sort();
    renderSidebarCategories();
    renderCheckboxes();
    renderManageList();
    renderTracks();
}

// --- 5. UPLOAD CLOUD & GESTION DES FICHIERS ---
importForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!isAdmin) return;

    const file = fileInput.files[0];
    if (!file) return;

    let finalTitle = titleInput.value.trim() || file.name.replace(/\.[^/.]+$/, "");
    
    // Gestion des tags cochés + nouveau tag
    const checkedBoxes = document.querySelectorAll('.cat-checkbox:checked');
    const selectedTags = Array.from(checkedBoxes).map(cb => cb.value);
    const newCatPending = newCategoryInput.value.trim();
    
    if (newCatPending && !categories.includes(newCatPending)) {
        categories.push(newCatPending);
        selectedTags.push(newCatPending);
        await db.collection('settings').doc('metadata').update({ categories });
    } else if (newCatPending && categories.includes(newCatPending) && !selectedTags.includes(newCatPending)) {
        selectedTags.push(newCatPending);
    }

    if (selectedTags.length === 0) {
        if (!categories.includes("Non classé")) {
            categories.push("Non classé");
            await db.collection('settings').doc('metadata').update({ categories });
        }
        selectedTags.push("Non classé");
    }

    // Affichage d'un état de chargement
    const btnSubmit = importForm.querySelector('button[type="submit"]');
    btnSubmit.textContent = "Upload en cours (veuillez patienter)...";
    btnSubmit.disabled = true;

    try {
        // 1. Envoi du fichier .wav/.mp3 sur Firebase Storage
        const storageRef = storage.ref(`prods/${Date.now()}_${file.name}`);
        const snapshot = await storageRef.put(file);
        const downloadURL = await snapshot.ref.getDownloadURL();

        // 2. Sauvegarde des infos de la piste dans la base de données Firestore
        await db.collection('tracks').add({
            title: finalTitle,
            url: downloadURL,
            storagePath: storageRef.fullPath,
            tags: selectedTags,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        // Succès
        importForm.reset();
        newCategoryInput.value = '';
        importModal.classList.add('hidden');
    } catch (error) {
        console.error("Erreur d'upload:", error);
        alert("Une erreur est survenue lors de l'upload.");
    } finally {
        btnSubmit.textContent = "Enregistrer la prod";
        btnSubmit.disabled = false;
    }
});

window.deleteTrack = async function(trackId, storagePath) {
    if (confirm("Voulez-vous vraiment supprimer cette prod pour tout le monde ?")) {
        try {
            // Suppression du fichier physique
            if (storagePath) await storage.ref(storagePath).delete();
            // Suppression dans la base de données
            await db.collection('tracks').doc(trackId).delete();
        } catch (error) {
            console.error("Erreur de suppression:", error);
        }
    }
};

window.editCategory = async function(oldName) {
    const newName = prompt(`Renommer le style "${oldName}" en :`, oldName);
    if (newName !== null && newName.trim() !== "" && newName !== oldName) {
        const trimmed = newName.trim();
        if (categories.includes(trimmed)) return alert("Ce style existe déjà.");

        categories[categories.indexOf(oldName)] = trimmed;
        await db.collection('settings').doc('metadata').update({ categories });

        // Mettre à jour toutes les prods ayant cet ancien tag
        const snapshot = await db.collection('tracks').where('tags', 'array-contains', oldName).get();
        const batch = db.batch();
        snapshot.forEach(doc => {
            const trackRef = db.collection('tracks').doc(doc.id);
            const updatedTags = doc.data().tags.map(t => t === oldName ? trimmed : t);
            batch.update(trackRef, { tags: updatedTags });
        });
        await batch.commit();

        if (activeFilter === oldName) activeFilter = trimmed;
    }
};

window.deleteCategory = async function(catName) {
    if (confirm(`Supprimer le style "${catName}" pour tout le monde ?`)) {
        categories = categories.filter(c => c !== catName);
        if (!categories.includes("Non classé")) categories.push("Non classé");
        
        await db.collection('settings').doc('metadata').update({ categories });

        const snapshot = await db.collection('tracks').where('tags', 'array-contains', catName).get();
        const batch = db.batch();
        snapshot.forEach(doc => {
            const trackRef = db.collection('tracks').doc(doc.id);
            let updatedTags = doc.data().tags.filter(t => t !== catName);
            if (updatedTags.length === 0) updatedTags.push("Non classé");
            batch.update(trackRef, { tags: updatedTags });
        });
        await batch.commit();

        if (activeFilter === catName) activeFilter = "Tous";
    }
};

// --- RENDER FUNCTIONS (Identiques, adaptées pour lire track.id et track.storagePath) ---
function renderTracks() {
    tracksContainer.innerHTML = '';
    const filteredTracks = activeFilter === "Tous" ? tracks : tracks.filter(t => t.tags.includes(activeFilter));

    if (filteredTracks.length === 0) {
        tracksContainer.innerHTML = `<p class="empty-state">Aucune prod trouvée.</p>`;
        return;
    }

    filteredTracks.forEach(track => {
        const card = document.createElement('div');
        card.className = 'track-card';
        const tagsHTML = track.tags.map(tag => `<span class="tag">${tag}</span>`).join('');

        card.innerHTML = `
            <div class="track-info">
                <div class="track-title">${track.title}</div>
                <div class="track-tags">${tagsHTML}</div>
            </div>
            <audio controls src="${track.url}" class="audio-player"></audio>
            <div class="track-admin-actions">
                <button class="btn-delete-track" onclick="deleteTrack('${track.id}', '${track.storagePath}')" title="Supprimer">✖</button>
            </div>
        `;

        const audioElement = card.querySelector('.audio-player');
        audioElement.addEventListener('play', () => {
            if (currentAudio && currentAudio !== audioElement) currentAudio.pause();
            currentAudio = audioElement;
        });
        tracksContainer.appendChild(card);
    });
}

function renderSidebarCategories() {
    categoryListDOM.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.innerHTML = `Tous <span class="count">${tracks.length}</span>`;
    if (activeFilter === "Tous") allLi.classList.add('active');
    allLi.addEventListener('click', () => { activeFilter = "Tous"; updateAllUIs(); });
    categoryListDOM.appendChild(allLi);

    categories.forEach(cat => {
        const count = tracks.filter(t => t.tags.includes(cat)).length;
        const li = document.createElement('li');
        li.innerHTML = `${cat} <span class="count">${count}</span>`;
        if (activeFilter === cat) li.classList.add('active');
        li.addEventListener('click', () => { activeFilter = cat; updateAllUIs(); });
        categoryListDOM.appendChild(li);
    });
}

function renderCheckboxes() {
    checkboxContainer.innerHTML = '';
    categories.forEach(cat => {
        const label = document.createElement('label');
        label.className = 'checkbox-item';
        label.innerHTML = `<input type="checkbox" value="${cat}" class="cat-checkbox"> ${cat}`;
        checkboxContainer.appendChild(label);
    });
}

function renderManageList() {
    const categoryManageList = document.getElementById('category-manage-list');
    if (!categoryManageList) return;
    
    categoryManageList.innerHTML = '';
    categories.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'category-manage-item';
        div.innerHTML = `
            <span>${cat}</span>
            <div class="category-actions">
                <button class="btn-icon edit" onclick="editCategory('${cat}')" title="Modifier">✎</button>
                <button class="btn-icon delete" onclick="deleteCategory('${cat}')" title="Supprimer">✖</button>
            </div>
        `;
        categoryManageList.appendChild(div);
    });
}

// --- GESTION DES ÉVÉNEMENTS RESTANTS (Glisser-Déposer & Modales) ---
btnAdminToggle.addEventListener('click', () => {
    if (isAdmin) {
        isAdmin = false; document.body.classList.remove('admin-mode');
        btnAdminToggle.innerHTML = '🔒 Connexion Admin';
    } else {
        if (prompt('Entrez la clé administrateur :') === ADMIN_PASSWORD) {
            isAdmin = true; document.body.classList.add('admin-mode');
            btnAdminToggle.innerHTML = '🔓 Déconnexion';
        } else { alert('Clé incorrecte.'); }
    }
});

let dragCounter = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); if (isAdmin) { dragCounter++; dragOverlay.classList.remove('hidden'); }});
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (isAdmin) { dragCounter--; if (dragCounter === 0) dragOverlay.classList.add('hidden'); }});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
    e.preventDefault(); if (!isAdmin) return;
    dragCounter = 0; dragOverlay.classList.add('hidden');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.name.endsWith('.wav') || file.name.endsWith('.mp3') || file.type.startsWith('audio/')) {
            fileInput.files = e.dataTransfer.files;
            titleInput.placeholder = file.name.replace(/\.[^/.]+$/, "");
            importModal.classList.remove('hidden');
        }
    }
});

btnOpenImport.addEventListener('click', () => importModal.classList.remove('hidden'));
btnCloseModal.addEventListener('click', () => importModal.classList.add('hidden'));
document.getElementById('btn-manage-categories').addEventListener('click', () => document.getElementById('manage-modal').classList.remove('hidden'));
document.getElementById('btn-close-manage-modal').addEventListener('click', () => document.getElementById('manage-modal').classList.add('hidden'));

document.getElementById('btn-manage-add').addEventListener('click', async () => {
    const newCat = document.getElementById('manage-new-category').value.trim();
    if (newCat && !categories.includes(newCat)) {
        categories.push(newCat);
        await db.collection('settings').doc('metadata').update({ categories });
        document.getElementById('manage-new-category').value = '';
    }
});