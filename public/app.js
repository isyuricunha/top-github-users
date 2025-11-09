let country = null;
let sortby = 'followers';
let data = null;

document.addEventListener('DOMContentLoaded', () => {
    init();
});

async function init() {
    await loadrankings();
    setuplisteners();
}

function setuplisteners() {
    const countryselect = document.getElementById('countrySelect');
    countryselect.addEventListener('change', (e) => {
        country = e.target.value;
        if (country) loadcountry(country);
    });

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            sortby = e.target.dataset.sort;
            if (data) renderusers();
        });
    });
}

async function loadrankings() {
    try {
        const response = await fetch('/api/rankings');
        const result = await response.json();
        
        if (result.error) {
            showerror('no data available');
            return;
        }

        populateselect(result.locations);
        updatelastupdated(result.updated_at);
        hideloading();
        
    } catch (error) {
        showerror('failed to load data');
    }
}

function populateselect(locations) {
    const select = document.getElementById('countrySelect');
    locations.forEach(loc => {
        const option = document.createElement('option');
        option.value = loc.country;
        option.textContent = loc.name;
        select.appendChild(option);
    });
}

async function loadcountry(countrycode) {
    showloading();
    
    try {
        const response = await fetch(`/api/location/${countrycode}`);
        data = await response.json();
        
        if (data.error) {
            showerror('country not found');
            return;
        }

        renderusers();
        updatestats();
        hideloading();
        
    } catch (error) {
        showerror('failed to load country data');
    }
}

function renderusers() {
    const list = document.getElementById('userList');
    list.innerHTML = '';

    let users = [];
    if (sortby === 'followers') users = data.users_by_followers || [];
    else if (sortby === 'public_contributions') users = data.users_by_public_contributions || [];
    else if (sortby === 'total_contributions') users = data.users_by_total_contributions || [];

    if (users.length === 0) {
        list.innerHTML = '<div class="loading">no users found</div>';
        return;
    }

    users.forEach((user, index) => {
        list.appendChild(createcard(user, index + 1));
    });
}

function createcard(user, rank) {
    const card = document.createElement('div');
    card.className = 'user-card';
    
    const bio = user.bio ? `<div class="user-bio">${escape(user.bio)}</div>` : '';
    const name = user.name ? escape(user.name) : user.username;
    const company = user.company ? `<span>${escape(user.company)}</span>` : '';
    const location = user.location ? `<span>${escape(user.location)}</span>` : '';
    
    card.innerHTML = `
        <div class="user-rank">#${rank}</div>
        <img src="${user.avatar}" alt="${user.username}" class="user-avatar" loading="lazy">
        <div class="user-info">
            <div class="user-name">${name}</div>
            <a href="${user.profile_url}" target="_blank" class="user-username">@${user.username}</a>
            ${bio}
            <div class="user-meta">
                ${company} ${location}
            </div>
        </div>
        <div class="user-stats">
            <div class="stat-item">
                <div class="stat-item-value">${format(user.followers)}</div>
                <div class="stat-item-label">followers</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${format(user.public_contributions)}</div>
                <div class="stat-item-label">public</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${format(user.total_contributions)}</div>
                <div class="stat-item-label">total</div>
            </div>
            <div class="stat-item">
                <div class="stat-item-value">${format(user.public_repos)}</div>
                <div class="stat-item-label">repos</div>
            </div>
        </div>
    `;
    
    return card;
}

function updatestats() {
    const users = data.users_by_followers || [];
    const stats = document.getElementById('stats');
    
    if (users.length === 0) {
        stats.style.display = 'none';
        return;
    }

    stats.style.display = 'grid';
    const totalfollowers = users.reduce((sum, u) => sum + (u.followers || 0), 0);
    const totalcontribs = users.reduce((sum, u) => sum + (u.total_contributions || 0), 0);
    
    document.getElementById('totalUsers').textContent = format(users.length);
    document.getElementById('avgFollowers').textContent = format(Math.round(totalfollowers / users.length));
    document.getElementById('totalContributions').textContent = format(totalcontribs);
}

function updatelastupdated(timestamp) {
    if (!timestamp) return;
    const date = new Date(timestamp);
    document.getElementById('lastUpdated').textContent = date.toLocaleDateString('en-us', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function showloading() {
    document.getElementById('loading').style.display = 'block';
    document.getElementById('userList').innerHTML = '';
}

function hideloading() {
    document.getElementById('loading').style.display = 'none';
}

function showerror(msg) {
    hideloading();
    document.getElementById('userList').innerHTML = `<div class="error">${msg}</div>`;
}

function format(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'm';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function escape(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
