import os
import json
import requests
import time
from datetime import datetime
from typing import List, Dict, Optional
from dotenv import load_dotenv

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

def main():
    token = os.getenv('GITHUB_TOKEN')
    
    if not token:
        print('error: github_token not found')
        return
    
    with open('config.json', 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    fetcher = githubfetcher(token, config.get('request_delay', 1.5))
    max_users = config.get('max_users_per_location', 100)
    
    all_rankings = {
        'updated_at': datetime.now().isoformat(),
        'locations': []
    }
    
    os.makedirs('data', exist_ok=True)
    
    for location_config in config['locations']:
        country = location_config['country']
        name = location_config['name']
        min_followers = location_config.get('min_followers', 0)
        
        print(f'\nfetching {name}...')
        
        basic_users = fetcher.search_users(country, min_followers, max_users)
        print(f'found {len(basic_users)} users')
        
        detailed_users = []
        
        for idx, user in enumerate(basic_users, 1):
            username = user.get('login')
            print(f'processing {idx}/{len(basic_users)}: {username}')
            
            try:
                details = fetcher.get_user_details(username)
                if not details:
                    continue
                
                contributions = fetcher.get_user_contributions(username)
                formatted = format_user_data(user, details, contributions)
                detailed_users.append(formatted)
            except Exception as e:
                print(f'error processing {username}: {str(e)}')
                continue
        
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
        
        with open(f'data/{country}.json', 'w', encoding='utf-8') as f:
            json.dump(location_data, f, indent=2, ensure_ascii=False)
        
        all_rankings['locations'].append({
            'country': country,
            'name': name,
            'total_users': len(detailed_users)
        })
        
        print(f'saved {name}')
    
    with open('data/rankings.json', 'w', encoding='utf-8') as f:
        json.dump(all_rankings, f, indent=2, ensure_ascii=False)
    
    print('\n✓ complete')

if __name__ == '__main__':
    main()
