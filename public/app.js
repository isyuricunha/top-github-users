let currentlocation = null;
let currenttype = 'followers';
let locationdata = null;

document.addEventListener('DOMContentLoaded', () => {
    loadrankings();
    setupeventlisteners();
});

function setupeventlisteners() {
    document.getElementById('locationSelect').addEventListener('change', (e) => {
        currentlocation = e.target.value;
        if (currentlocation) {
            loadlocationdata(currentlocation);
        }
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            currenttype = e.target.dataset.type;
            if (locationdata) {
                renderusers();
            }
        });
    });
}

async function loadrankings() {
    try {
        const response = await fetch('/api/rankings');
        const data = await response.json();
        
        if (data.error) {
            showerror('no ranking data available');
            return;
        }

        populatelocationselect(data.locations);
        updatelastupdated(data.updated_at);
        
    } catch (error) {
        showerror('failed to load rankings');
        console.error(error);
    }
}

function populatelocationselect(locations) {
    const select = document.getElementById('locationSelect');
    
    locations.forEach(location => {
        const option = document.createElement('option');
        option.value = location.country;
        option.textContent = location.name;
        select.appendChild(option);
    });
}

async function loadlocationdata(country) {
    showloading();
    
    try {
        const response = await fetch(`/api/location/${country}`);
        locationdata = await response.json();
        
        if (locationdata.error) {
            showerror('location not found');
            return;
        }

        renderusers();
        updatestats();
        
    } catch (error) {
        showerror('failed to load location data');
        console.error(error);
    }
}

function renderusers() {
    const userlist = document.getElementById('userList');
    userlist.innerHTML = '';

    let users = [];
    
    if (currenttype === 'followers') {
        users = locationdata.users_by_followers || [];
    } else if (currenttype === 'public_contributions') {
        users = locationdata.users_by_public_contributions || [];
    } else if (currenttype === 'total_contributions') {
        users = locationdata.users_by_total_contributions || [];
    }

    if (users.length === 0) {
        userlist.innerHTML = '<div class="loading">no users found</div>';
        return;
    }

    users.forEach((user, index) => {
        const card = createusercard(user, index + 1);
        userlist.appendChild(card);
    });
}

function createusercard(user, rank) {
    const card = document.createElement('div');
    card.className = 'user-card';
    
    const bio = user.bio ? `<div class="user-bio">${escapehtml(user.bio)}</div>` : '';
    const name = user.name ? escapehtml(user.name) : user.username;
    const company = user.company ? `<span>🏢 ${escapehtml(user.company)}</span>` : '';
    const location = user.location ? `<span>📍 ${escapehtml(user.location)}</span>` : '';
    
    card.innerHTML = `
        <div class="user-rank">#${rank}</div>
        <img src="${user.avatar}" alt="${user.username}" class="user-avatar" loading="lazy">
        <div class="user-info">
            <div class="user-name">${name}</div>
            <a href="${user.profile_url}" target="_blank" class="user-username">@${user.username}</a>
            ${bio}
            <div class="user-meta">
                ${company}
                ${location}
            </div>
        </div>
        <div class="user-stats">
            <div class="stat-item">
                <div class="stat-item-value">${formatnumber(user.followers)}</div>
                <div class="stat-item-label">followers</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${formatnumber(user.public_contributions)}</div>
                <div class="stat-item-label">public</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${formatnumber(user.total_contributions)}</div>
                <div class="stat-item-label">total</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${formatnumber(user.public_repos)}</div>
                <div class="stat-item-label">repos</div>
            </div>
        </div>
    `;
    
    return card;
}

function updatestats() {
    const users = locationdata.users_by_followers || [];
    
    if (users.length === 0) {
        document.getElementById('totalUsers').textContent = '0';
        document.getElementById('avgFollowers').textContent = '0';
        document.getElementById('avgContributions').textContent = '0';
        return;
    }

    const totalfollowers = users.reduce((sum, user) => sum + (user.followers || 0), 0);
    const totalcontributions = users.reduce((sum, user) => sum + (user.public_contributions || 0), 0);
    
    document.getElementById('totalUsers').textContent = formatnumber(users.length);
    document.getElementById('avgFollowers').textContent = formatnumber(Math.round(totalfollowers / users.length));
    document.getElementById('avgContributions').textContent = formatnumber(Math.round(totalcontributions / users.length));
}

function updatelastupdated(timestamp) {
    if (!timestamp) return;
    
    const date = new Date(timestamp);
    const formatted = date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    document.getElementById('lastUpdated').textContent = formatted;
}

function showloading() {
    const userlist = document.getElementById('userList');
    userlist.innerHTML = '<div class="loading">loading users...</div>';
}

function showerror(message) {
    const userlist = document.getElementById('userList');
    userlist.innerHTML = `<div class="error">${message}</div>`;
}

function formatnumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'm';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'k';
    }
    return num.toString();
}

function escapehtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
