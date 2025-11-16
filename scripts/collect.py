import os
import json
import requests
import time
from datetime import datetime
from typing import List, Dict, Optional
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

load_dotenv()

class githubfetcher:
    def __init__(self, token: str, delay: float = 1.5):
        self.token = token
        self.delay = delay
        self.headers = {
            'authorization': f'token {token}',
            'accept': 'application/vnd.github.v3+json'
        }
        self.base_url = 'https://api.github.com'

    def search_users(self, location: str, min_followers: int = 0, max_results: int = 100) -> List[Dict]:
        users = []
        page = 1
        
        while len(users) < max_results:
            query = f'location:{location} followers:>={min_followers}'
            url = f'{self.base_url}/search/users'
            params = {
                'q': query,
                'sort': 'followers',
                'order': 'desc',
                'per_page': min(100, max_results - len(users)),
                'page': page
            }
            
            try:
                response = requests.get(url, headers=self.headers, params=params)
                
                if response.status_code == 403:
                    print(f'rate limit reached, waiting...')
                    time.sleep(60)
                    continue
                
                if response.status_code != 200:
                    print(f'error fetching users: {response.status_code}')
                    break
                
                data = response.json()
                items = data.get('items', [])
                
                if not items:
                    break
                
                users.extend(items)
                page += 1
                time.sleep(self.delay)
                
            except Exception as e:
                print(f'exception: {str(e)}')
                break
        
        return users[:max_results]

    def get_user_details(self, username: str) -> Optional[Dict]:
        url = f'{self.base_url}/users/{username}'
        
        try:
            response = requests.get(url, headers=self.headers)
            
            if response.status_code == 200:
                time.sleep(self.delay)
                return response.json()
            else:
                print(f'failed to fetch {username}: {response.status_code}')
                return None
                
        except Exception as e:
            print(f'exception: {str(e)}')
            return None

    def get_user_contributions(self, username: str) -> Dict:
        query = '''
        query($login: String!) {
          user(login: $login) {
            contributionsCollection {
              contributionCalendar {
                totalContributions
              }
              restrictedContributionsCount
            }
          }
        }
        '''
        
        url = 'https://api.github.com/graphql'
        
        try:
            response = requests.post(
                url,
                headers=self.headers,
                json={'query': query, 'variables': {'login': username}}
            )
            
            if response.status_code == 200:
                data = response.json()
                user_data = data.get('data', {}).get('user', {})
                contributions = user_data.get('contributionsCollection', {})
                
                public_contribs = contributions.get('contributionCalendar', {}).get('totalContributions', 0)
                private_contribs = contributions.get('restrictedContributionsCount', 0)
                
                time.sleep(self.delay)
                
                return {
                    'public_contributions': public_contribs,
                    'total_contributions': public_contribs + private_contribs
                }
            else:
                return {'public_contributions': 0, 'total_contributions': 0}
                
        except Exception as e:
            print(f'exception: {str(e)}')
            return {'public_contributions': 0, 'total_contributions': 0}

def format_user_data(user_basic: Dict, user_details: Dict, contributions: Dict) -> Dict:
    return {
        'rank': 0,
        'username': user_basic.get('login', ''),
        'name': user_details.get('name', ''),
        'avatar': user_basic.get('avatar_url', ''),
        'profile_url': user_basic.get('html_url', ''),
        'followers': user_details.get('followers', 0),
        'public_repos': user_details.get('public_repos', 0),
        'public_contributions': contributions.get('public_contributions', 0),
        'total_contributions': contributions.get('total_contributions', 0),
        'bio': user_details.get('bio', ''),
        'company': user_details.get('company', ''),
        'location': user_details.get('location', ''),
        'twitter': user_details.get('twitter_username', ''),
        'blog': user_details.get('blog', '')
    }

def rank_users(users: List[Dict], criterion: str = 'followers') -> List[Dict]:
    return sorted(users, key=lambda x: x.get(criterion, 0), reverse=True)

def load_checkpoint():
    checkpoint_file = 'checkpoint.json'
    if os.path.exists(checkpoint_file):
        with open(checkpoint_file, 'r') as f:
            return json.load(f)
    return {'completed': [], 'in_progress': None}

def save_checkpoint(completed, in_progress=None):
    with open('checkpoint.json', 'w') as f:
        json.dump({'completed': completed, 'in_progress': in_progress}, f)

def process_user(fetcher, user):
    username = user.get('login')
    try:
        details = fetcher.get_user_details(username)
        if not details:
            return None
        contributions = fetcher.get_user_contributions(username)
        return format_user_data(user, details, contributions)
    except Exception as e:
        print(f'exception: {str(e)}')
        return None

def process_location(config_item, token, max_users, delay):
    country = config_item['country']
    name = config_item['name']
    min_followers = config_item.get('min_followers', 0)
    
    print(f'\nfetching {name}...')
    
    fetcher = githubfetcher(token, delay)
    basic_users = fetcher.search_users(country, min_followers, max_users)
    print(f'found {len(basic_users)} users')
    
    detailed_users = []
    lock = threading.Lock()
    
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_user, fetcher, user): (idx, user) for idx, user in enumerate(basic_users, 1)}
        
        for future in as_completed(futures):
            idx, user = futures[future]
            username = user.get('login')
            print(f'processing {idx}/{len(basic_users)}: {username}')
            
            result = future.result()
            if result:
                with lock:
                    detailed_users.append(result)
    
    ranked_by_followers = rank_users(detailed_users, 'followers')
    ranked_by_public = rank_users(detailed_users, 'public_contributions')
    ranked_by_total = rank_users(detailed_users, 'total_contributions')
    
    for idx, user in enumerate(ranked_by_followers, 1):
        user['rank'] = idx
    
    location_data = {
        'country': country,
        'name': name,
        'users_by_followers': ranked_by_followers,
        'users_by_public_contributions': ranked_by_public,
        'users_by_total_contributions': ranked_by_total
    }
    
    os.makedirs('data', exist_ok=True)
    with open(f'data/{country}.json', 'w', encoding='utf-8') as f:
        json.dump(location_data, f, indent=2, ensure_ascii=False)
    
    print(f'saved {name}')
    
    return {
        'country': country,
        'name': name,
        'total_users': len(detailed_users)
    }

def main():
    token = os.getenv('GITHUB_TOKEN')
    
    if not token:
        print('error: github_token not found')
        return
    
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    max_users = config.get('max_users_per_location', 100)
    delay = config.get('request_delay', 1.0)
    
    checkpoint = load_checkpoint()
    completed_countries = set(checkpoint['completed'])
    
    all_rankings = {
        'updated_at': datetime.now().isoformat(),
        'locations': []
    }
    
    for location_config in config['locations']:
        country = location_config['country']
        
        if country in completed_countries:
            print(f'skipping {country} (already completed)')
            continue
        
        try:
            location_summary = process_location(location_config, token, max_users, delay)
            all_rankings['locations'].append(location_summary)
            
            completed_countries.add(country)
            save_checkpoint(list(completed_countries))
            
        except Exception as e:
            print(f'error processing {country}: {str(e)}')
            save_checkpoint(list(completed_countries), country)
            continue
    
    with open('data/rankings.json', 'w', encoding='utf-8') as f:
        json.dump(all_rankings, f, indent=2, ensure_ascii=False)
    
    if os.path.exists('checkpoint.json'):
        os.remove('checkpoint.json')
    
    print('\n✓ complete')

if __name__ == '__main__':
    main()
